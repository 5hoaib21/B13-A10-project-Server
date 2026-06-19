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
const PORT = process.env.PORT;

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

  if(!token) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  try {
    const { payload } = await jwtVerify(token, JWKS);
    req.user = payload; // Attach the payload to the request object for further use
    next();
  } catch (error) {
    console.error("Token verification failed:", error);
    return res.status(401).json({ message: "Unauthorized" });
  }
}

const creatorVerifyToken = async (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "creator" || user.plan !== "pro") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next()
  // const authHeader = req.headers.authorization;
  // console.log('authHeader:', authHeader); 
}
const userVerifyToken = async (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "user" || user.plan !== "pro") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next()
  // const authHeader = req.headers.authorization;
  // console.log('authHeader:', authHeader); 
}
const adminVerifyToken = async (req, res, next) => {
  const user = req.user;
  if (!user || user.role !== "admin") {
    return res.status(403).json({ message: "Forbidden" });
  }
  next()
  // const authHeader = req.headers.authorization;
  // console.log('authHeader:', authHeader); 
}

async function run() {
  try {
    await client.connect();
    const db = client.db("tech-bazaar");
    const usersCollection = db.collection("user");
    const subscriptionsCollection = db.collection("subscriptions");
    const promptsCollection = db.collection("prompts");

    app.post("/subscriptions", async (req, res) => {
      const { userId, priceId, sessionId } = req.body;
      const isExistingSubscription = await subscriptionsCollection.findOne({
        sessionId,
      });
      if (isExistingSubscription) {
        return res.status(400).json({ message: "Subscription already exists" });
      }
      await subscriptionsCollection.insertOne({
        userId,
        priceId,
        sessionId,
      });
      console.log("userId:", userId);
      const updatedResult = await usersCollection.updateOne(
        { _id: new ObjectId(userId) },
        { $set: { plan: "pro" } },
      );

      res.json({ message: "Subscription created successfully" });
    });

    app.post("/creator/prompts", verifyToken, creatorVerifyToken, async (req, res) => {
  try {
    const data = req.body;
    
    // 💡 Logging incoming request to debug payload mismatches safely
    // console.log("Incoming prompt asset payload:", data);
    // console.log("Verified system route user token scope ID:", req.user?.id);

    if (!req.user?.id) {
      return res.status(401).json({ success: false, error: "Unauthorized access: Missing user session entity context." });
    }

    // Explicit compilation pipeline creation matching object keys structure
    const promptDocument = {
      ...data,
      userId: req.user.id,
      createdAt: new Date() // Standard architecture logging practice
    };

    const result = await promptsCollection.insertOne(promptDocument);
    
    // 💡 Return a clean structure to client to avoid JSON parsing exceptions
    return res.status(201).json({
      success: true,
      message: "Prompt entity securely committed to target dataset context.",
      insertedId: result.insertedId
    });

  } catch (error) {
    // console.error("Backend Database Write Exception Triggered:", error);
    return res.status(500).json({ 
      success: false, 
      error: "Internal server processing failure while mapping database document." 
    });
  }
});

    app.get('/creator/prompts', verifyToken, creatorVerifyToken, async (req, res) => {
      
      const result = await promptsCollection.find({ userId: req.user.id }).toArray();
      res.json(result);
    })







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
