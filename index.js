const dns = require("node:dns");
dns.setServers(["1.1.1.1", "1.0.0.1"]);

const express = require("express");
const dontenv = require("dotenv");
const cors = require("cors");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const { jwtVerify, createRemoteJWKSet } = require("jose-cjs");
dontenv.config();

const uri = process.env.MONGODB_URI;

const app = express();
const PORT = process.env.PORT || 5005;

app.use(
  cors({
    credentials: true,
    origin: [process.env.CLIENT_URL],
  }),
);
app.use(express.json());

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

const JWKS = createRemoteJWKSet(
  new URL(`${process.env.CLIENT_URL}/api/auth/jwks`),
);

const verifyToken = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  // console.log('authHeader:', authHeader);
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  // console.log('token:', token);

  if (!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload; // Attach the payload to the request object for further use
    next();
  } catch (error) {
    // console.error("Token verification failed:", error);
    return res.status(401).json({ message: "Unauthorized" });
  }
};

//verification
const creatorVerifyToken = async (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "creator" || user.plan !== "pro") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
  // const authHeader = req.headers.authorization;
  // console.log('authHeader:', authHeader);
};
const userVerifyToken = async (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "user" || user.plan !== "pro") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
  // const authHeader = req.headers.authorization;
  // console.log('authHeader:', authHeader);
};
const adminVerifyToken = async (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next();
  // const authHeader = req.headers.authorization;
  // console.log('authHeader:', authHeader);
};

async function run() {
  try {
    await client.connect();
    const db = client.db("tech-bazaar");
    const usersCollection = db.collection("user");
    const subscriptionsCollection = db.collection("subscriptions");
    const promptsCollection = db.collection("prompts");
    const reportsCollection = db.collection("reports");

    //done!
    app.post("/subscriptions", async (req, res) => {
      const { userId, priceId, sessionId, price, customerName, customerEmail  } = req.body;
      const isExistingSubscription = await subscriptionsCollection.findOne({
        sessionId,
      });
      if (isExistingSubscription) {
        return res.status(400).json({ message: "Subscription already exists" });
      }
      await subscriptionsCollection.insertOne({
        userId,
        customerEmail: customerEmail || "N/A",
        customerName: customerName || "N/A",
        priceId,
        sessionId,
        price,
      });
      // console.log("userId:", userId);
      const updatedResult = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { plan: "pro" } },
      );

      res.json({ message: "Subscription created successfully" });
    });
    
    //done!
    app.post("/api/prompts", verifyToken,async (req, res) => {
        try {
          const data = req.body;
          if (!req.user?.id) {
            return res.status(401).json({
              success: false,
              error:
                "Unauthorized access: Missing user session entity context.",
            });
          }

          const userId = req.user.id;
          const userObjectId = new ObjectId(userId);

          const user = await usersCollection.findOne({ _id: userObjectId })
          if(!user) {
            return res.status(404).json({
              success: false,
              error: 'user account context not found in database'
            })
          } 

          const isPro = user.plan === 'pro';

          if(!isPro) {
            const existingPromptCount = await promptsCollection.countDocuments({
              $or: [{ userId: userObjectId }, { userId: userId }]
            })
            if(existingPromptCount >= 3) {
              return res.status(403).json({
                success: false,
                isLimitExceeded: true,
                error: "Limit exceeded: Free tier accounts are capped at 3 prompts. Please upgrade to premium.",
              })
            }
          }


          const promptDocument = {
            ...data,
            userId: req.user.id,
            createdAt: new Date(),
          };

          const result = await promptsCollection.insertOne(promptDocument);

          return res.status(201).json({
            success: true,
            message:
              "Prompt entity securely committed to target dataset context.",
            insertedId: result.insertedId,
          });
        } catch (error) {
          return res.status(500).json({
            success: false,
            error:
              "Internal server processing failure while mapping database document.",
          });
        }
      },
    );

    //done!
    app.post("/api/prompts/:id/review", verifyToken, async (req, res) => {
      try {
        const promptId = req.params.id;
        const { rating, comment } = req.body;

        const userId = req.user.id;
        const userName = req.user.name || "Anonymous";

        if (!rating || rating < 1 || rating > 5) {
          return res.status(400).json({
            success: false,
            message: "Invalid rating. Must be between 1 and 5.",
          });
        }

        const newReview = {
          userId: new ObjectId(userId),
          userName,
          rating: Number(rating),
          comment: comment || "",
          createdAt: new Date(),
        };

        const prompt = await promptsCollection.findOne({
          _id: new ObjectId(promptId),
        });
        if (!prompt) {
          return res
            .status(404)
            .json({ success: false, message: "Prompt not found." });
        }

        const currentReviews = prompt.reviews || [];
        const totalReviewsCount = currentReviews.length + 1;

        const currentRatingSum = currentReviews.reduce(
          (sum, rev) => sum + rev.rating,
          0,
        );
        const newAverageRating =
          (currentRatingSum + Number(rating)) / totalReviewsCount;

        const result = await promptsCollection.updateOne(
          { _id: new ObjectId(promptId) },
          {
            $push: { reviews: newReview },
            $set: { rating: newAverageRating },
            $inc: { ratingCount: 1, totalReviews: 1 },
          },
        );

        return res.status(200).json({
          success: true,
          message: "Review added successfully.",
          newReview,
        });
      } catch (error) {
        // console.error("Review Error:", error);
        return res.status(500).json({
          success: false,
          error: "Internal server error during review submission.",
        });
      }
    });

    //done!
    app.post("/api/prompts/:id/report", verifyToken, async (req, res) => {
      try {
        const promptId = req.params.id;
        const userId = req.user.id;
        const { reason, description } = req.body;

        if (!reason) {
          return res
            .status(400)
            .json({ success: false, message: "Reason is required." });
        }

        const newReport = {
          promptId: new ObjectId(promptId),
          userId: new ObjectId(userId),
          reason,
          description: description || "",
          status: "pending",
          createdAt: new Date(),
        };

        const result = await reportsCollection.insertOne(newReport);

        return res.status(201).json({
          success: true,
          message: "Prompt reported successfully. Admin will review it.",
        });
      } catch (error) {
        // console.error("Report Error:", error);
        return res.status(500).json({
          success: false,
          error: "Internal server error during reporting.",
        });
      }
    });

    //done!
    app.patch("/api/prompts/:id/copy", verifyToken, async (req, res) => {
      try {
        const promptId = req.params.id;
        // console.log("📥 Received Prompt ID for copy:", promptId);

        const result = await promptsCollection.updateOne(
          { _id: new ObjectId(promptId) },
          { $inc: { copyCount: 1 } },
        );
        // console.log("Result:", result);
        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Prompt not found.",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Copy count updated successfully.",
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: "Internal server error during copy update.",
        });
      }
    });

    //done!
    app.patch("/api/prompts/:id", verifyToken, async (req, res) => {
      try {
        const promptId = req.params.id;
        const updatedData = req.body;

        if (!req.user?.id) {
          return res.status(401).json({
            success: false,
            error: "Unauthorized access.",
          });
        }

        const {
          title,
          content,
          aiTool,
          difficulty,
          category,
          visibility,
          tags,
        } = updatedData;

        const updateDoc = {
          $set: {
            ...(title && { title }),
            ...(content && { content }),
            ...(aiTool && { aiTool }),
            ...(difficulty && { difficulty }),
            ...(category && { category }),
            ...(visibility && { visibility }),
            ...(Array.isArray(tags) && { tags }),
            updatedAt: new Date(),
          },
        };

        const query = {
          _id: new ObjectId(promptId),
          userId: req.user.id,
        };

        const result = await promptsCollection.updateOne(query, updateDoc);

        if (result.matchedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Prompt not found or you don't have permission to update.",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Prompt updated successfully.",
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: "Internal server error during update.",
        });
      }
    });

    //done!
    app.patch("/api/prompts/:id/bookmark", verifyToken, async (req, res) => {
      try {
        const promptId = req.params.id;
        const userId = req.user.id;

        const prompt = await promptsCollection.findOne({
          _id: new ObjectId(promptId),
          bookmarks: new ObjectId(userId),
        });

        let updateQuery;
        let isSavedNow;

        if (prompt) {
          updateQuery = { $pull: { bookmarks: new ObjectId(userId) } };
          isSavedNow = false;
        } else {
          updateQuery = { $addToSet: { bookmarks: new ObjectId(userId) } };
          isSavedNow = true;
        }

        const result = await promptsCollection.updateOne(
          { _id: new ObjectId(promptId) },
          updateQuery,
        );

        return res.status(200).json({
          success: true,
          isSaved: isSavedNow,
          message: isSavedNow
            ? "Added to bookmarks."
            : "Removed from bookmarks.",
        });
      } catch (error) {
        // console.error("Bookmark Error:", error);
        return res.status(500).json({
          success: false,
          error: "Internal server error during bookmark toggle.",
        });
      }
    });

    //done!
    app.delete("/api/prompts/:id", verifyToken, async (req, res) => {
      try {
        const promptId = req.params.id;

        if (!req.user?.id) {
          return res
            .status(401)
            .json({ success: false, error: "Unauthorized access." });
        }

        const query = {
          _id: new ObjectId(promptId),
          userId: req.user.id,
        };

        const result = await promptsCollection.deleteOne(query);

        if (result.deletedCount === 0) {
          return res.status(404).json({
            success: false,
            message: "Prompt not found or you don't have permission to delete.",
          });
        }

        return res.status(200).json({
          success: true,
          message: "Prompt deleted successfully.",
        });
      } catch (error) {
        return res.status(500).json({
          success: false,
          error: "Internal server error during deletion.",
        });
      }
    });

    //done!
    app.get(
      "/api/prompts",
      verifyToken,

      async (req, res) => {
        const { page = 1, limit = 10 } = req.query;
        const skip = (Number(page) - 1) * Number(limit);

        const result = await promptsCollection
          .find({ userId: req.user.id })
          .skip(skip)
          .limit(Number(limit))
          .toArray();
        const totalData = await promptsCollection.countDocuments({
          userId: req.user.id,
        });
        const totalPages = Math.ceil(totalData / Number(limit));
        res.json({ data: result, page: Number(page), totalPages });
      },
    );

    //pending.... pending prompt for admin approval
    app.get("/admin/prompts", verifyToken, adminVerifyToken, async (req, res) => {
      const query = {};
      const result = await promptsCollection.find(query).toArray();
      console.log('result form admin route:', result);
      res.json(result);
    });

    //done! public api
    app.get("/prompts", async (req, res) => {
      try {
        const { search, category, aiTool, difficulty, sort } = req.query;

        // console.log("📥 Received query:", {
        //   search,
        //   category,
        //   aiTool,
        //   difficulty,
        //   sort,
        // });

        const query = {};

        // Status
        if (req.query.status) {
          query.status = req.query.status;
        }

        // Search
        if (search && search !== "undefined" && search !== "") {
          query.$or = [
            { title: { $regex: search, $options: "i" } },
            { tags: { $regex: search, $options: "i" } },
            { aiTool: { $regex: search, $options: "i" } },
          ];
        }

        // Category
        if (category && category !== "all" && category !== "undefined") {
          query.category = category;
        }

        // AI Tool
        if (aiTool && aiTool !== "all" && aiTool !== "undefined") {
          query.aiTool = aiTool;
        }

        // ✅ Difficulty
        if (
          difficulty &&
          difficulty !== "all" &&
          difficulty !== "undefined" &&
          difficulty !== ""
        ) {
          query.difficulty = difficulty; // ← এটা ঠিক আছে
          // console.log("✅ Difficulty added to query:", difficulty);
        }

        // console.log("🔍 Final MongoDB Query:", JSON.stringify(query, null, 2));

        // console.log("🔍 MongoDB Query:", JSON.stringify(query, null, 2));

        // Sort
        let sortOptions = { createdAt: -1 };
        if (sort === "popular") {
          sortOptions = { ratingCount: -1 };
        } else if (sort === "copied") {
          sortOptions = { copyCount: -1 };
        }

        const result = await promptsCollection
          .find(query)
          .sort(sortOptions)
          .toArray();

        // console.log(`✅ Found ${result.length} prompts`);
        res.json(result);
      } catch (error) {
        // console.error("❌ Error:", error);
        res.status(500).json({
          success: false,
          message: error.message,
        });
      }
    });

    //done!
    app.get("/prompts/:id", async (req, res) => {
      const { id } = req.params;
      const result = await promptsCollection.findOne({ _id: new ObjectId(id) });
      res.json(result);
    });

    //done!
    app.get("/api/my-bookmarks", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

        const savedPrompts = await promptsCollection
          .find({
            bookmarks: new ObjectId(userId),
          })
          .toArray();

        return res.status(200).json({
          success: true,
          data: savedPrompts,
        });
      } catch (error) {
        // console.error("Error fetching bookmarks:", error);
        return res
          .status(500)
          .json({ success: false, error: "Internal server error." });
      }
    });

    //done!
    app.get("/api/my-reviews", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

        const promptsWithMyReviews = await promptsCollection
          .find({
            "reviews.userId": new ObjectId(userId),
          })
          .toArray();

        const myReviews = promptsWithMyReviews.map((prompt) => {
          const userSpecificReview = prompt.reviews.find(
            (rev) => rev.userId.toString() === userId,
          );
          return {
            _id: prompt._id,
            promptTitle: prompt.title,
            aiTool: prompt.aiTool,
            category: prompt.category,
            myRating: userSpecificReview?.rating || 0,
            myComment: userSpecificReview?.comment || "",
            reviewedAt: userSpecificReview?.createdAt || new Date(),
          };
        });

        return res.status(200).json({
          success: true,
          data: myReviews,
        });
      } catch (error) {
        // console.error("Error fetching user reviews:", error);
        return res
          .status(500)
          .json({ success: false, error: "Internal server error." });
      }
    });

    //done!
    app.get("/api/my-profile", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id;

        const user = await usersCollection.findOne({
          _id: new ObjectId(userId),
        });

        if (!user) {
          return res
            .status(404)
            .json({ success: false, error: "User not found." });
        }

        const totalPrompts = await promptsCollection.countDocuments({
          $or: [{ userId: new ObjectId(userId) }, { userId: userId }],
        });

        return res.status(200).json({
          success: true,
          data: {
            name: user.name,
            email: user.email,
            image: user.image || "",
            role: user.role || "user",
            plan: user.plan || "free",
            totalPrompts: totalPrompts || 0,
          },
        });
      } catch (error) {
        // console.error("Profile Error:", error);
        return res
          .status(500)
          .json({ success: false, error: "Internal server error." });
      }
    });

    //done!
    app.get("/api/creator-analytics", verifyToken, async (req, res) => {
      try {
        const creatorId = req.user.id; // verifyToken থেকে পাওয়া আইডি

        if (!creatorId) {
          return res
            .status(400)
            .json({ success: false, error: "User ID missing from token." });
        }

        const creatorObjectId = new ObjectId(creatorId);

        const totalPrompts = await promptsCollection.countDocuments({
          $or: [{ userId: creatorObjectId }, { userId: creatorId }],
        });

        const stats = await promptsCollection
          .aggregate([
            {
              $match: {
                $or: [{ userId: creatorObjectId }, { userId: creatorId }],
              },
            },
            {
              $group: {
                _id: null,
                totalCopies: { $sum: { $ifNull: ["$copyCount", 0] } },

                totalBookmarks: {
                  $sum: {
                    $cond: {
                      if: { $isArray: "$bookmarks" },
                      then: { $size: "$bookmarks" },
                      else: 0,
                    },
                  },
                },
              },
            },
          ])
          .toArray();

        // console.log(
        //   `Analytics for ${creatorId} -> Prompts: ${totalPrompts}, Copies: ${stats[0]?.totalCopies || 0}`,
        // );

        return res.status(200).json({
          success: true,
          analytics: {
            totalPrompts: totalPrompts || 0,
            totalCopies: stats[0]?.totalCopies || 0,
            totalBookmarks: stats[0]?.totalBookmarks || 0,
          },
        });
      } catch (error) {
        // console.error("Analytics Error:", error);
        return res
          .status(500)
          .json({ success: false, error: "Internal server error." });
      }
    });

    //done!
    app.get("/api/user-analytics", verifyToken, async (req, res) => {
      try {
        const userId = req.user.id; 
        const userObjectId = new ObjectId(userId);

        const totalBookmarks = await promptsCollection.countDocuments({
          bookmarks: { $in: [userId, userObjectId] }, 
        });

        const totalReviews = await promptsCollection.countDocuments({
          "reviews.userId": userObjectId,
        });

        return res.status(200).json({
          success: true,
          analytics: {
            totalBookmarks: totalBookmarks || 0,
            totalReviews: totalReviews || 0,
            totalCopies: 0, 
          },
        });
      } catch (error) {
        // console.error("User Analytics Error:", error);
        return res
          .status(500)
          .json({ success: false, error: "Internal server error." });
      }
    });


    // app.get('/api/prompts', async (req, res) => {

    // })

    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!",
    );
  } finally {
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Server is running fine!");
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
