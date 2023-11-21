const express = require("express");
const app = express();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 4000;

app.use(
  cors({
    origin: ["https://libra-tech.web.app", "http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.jazz428.mongodb.net/?retryWrites=true&w=majority`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    client.connect();
    // Send a ping to confirm a successful connection
    client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );

    // Collections
    const categoriesCollection = client
      .db("libratech")
      .collection("categories");
    const booksCollection = client.db("libratech").collection("books");
    const borrowedBooksCollection = client
      .db("libratech")
      .collection("borrowedBooks");

    // Middlewares
    const authenticate = (req, res, next) => {
      const token = req?.cookies?.access_token;

      if (!token) {
        return res.status(403).send({ message: "unauthorized" });
      }

      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "forbidden" });
        }

        req.user = decoded;
        next();
      });
    };

    const authorize = (req, res, next) => {
      const user = req.user;
      const userEmail = user.email;

      if (userEmail !== "admin@libratech.com") {
        return res.send({ message: "unauthorized" });
      }

      next();
    };

    // Sign JWT Token
    app.post("/api/v1/jwt", async (req, res) => {
      try {
        const email = req.body.email;
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN_SECRET, {
          expiresIn: "1h",
        });
        res
          .cookie("access_token", token, {
            httpOnly: true,
            sameSite: "none",
            secure: true,
          })
          .send({ message: "success" });
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    // Cancel JWT Token
    app.get("/api/v1/cancel-token", async (req, res) => {
      try {
        const result = res.clearCookie("access_token", {
          maxAge: 0,
          secure: true,
          sameSite: "none",
        });

        console.log(result);

        res.send({ message: "success" });
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    // Get Categories
    app.get("/api/v1/categories", async (req, res) => {
      try {
        let limit = 500;
        if (req.query.limit) {
          limit = Number(req.query.limit);
        }

        const filter = {};

        if (req.query.name) {
          filter.name = req.query.name;
        }

        const cursor = categoriesCollection.find(filter).limit(limit);
        const result = await cursor.toArray();
        res.send(result);
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    // Get Books
    app.get("/api/v1/books", async (req, res) => {
      try {
        const filter = {};
        const limit = Number(req.query.limit) || 4000;
        const skip = Number(req.query.skip) || 0;

        if (req.query.category) {
          filter.category = req.query.category;
        }

        if (req.query.id) {
          filter._id = new ObjectId(req.query.id);
        }

        const cursor = booksCollection.find(filter).skip(skip).limit(limit);
        const result = await cursor.toArray();

        res.send(result);
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    // Get Filtered Books
    app.get("/api/v1/filtered-books", async (req, res) => {
      try {
        const filter = {};

        const limit = Number(req.query.limit) || 4000;
        const skip = Number(req.query.skip) || 0;

        if (req.query.quantity && req.query.value === "lt") {
          filter.quantity = { $lt: Number(req.query.quantity) };
        }
        if (req.query.quantity && req.query.value === "gt") {
          filter.quantity = { $gt: Number(req.query.quantity) };
        }

        if (req.query.category) {
          filter.category = req.query.category;
        }

        if (req.query.id) {
          filter._id = new ObjectId(req.query.id);
        }

        const result = await booksCollection
          .find(filter)
          .skip(skip)
          .limit(limit)
          .toArray();

        res.send({ message: "success", result });
      } catch (error) {
        res.status(404).send({ message: error });
      }
    });

    // Get Books Count
    app.get("/api/v1/books-count", authenticate, async (req, res) => {
      try {
        const result = await booksCollection.estimatedDocumentCount();
        res.send({ message: "success", count: result });
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    app.get("/api/v1/borrow-book", authenticate, async (req, res) => {
      try {
        const email = req.query.email;

        const result = await borrowedBooksCollection.find({ email }).toArray();

        res.send({ message: "success", result });
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    app.post("/api/v1/add-book", authenticate, authorize, async (req, res) => {
      try {
        const bookData = req.body;

        const result = await booksCollection.insertOne(bookData);

        if (result.acknowledged && result.insertedId) {
          res.send({ message: "success" });
        } else {
          res.send({ message: "error" });
        }
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    app.post("/api/v1/borrow-book", authenticate, async (req, res) => {
      const borrowData = req.body;
      const findSame = await borrowedBooksCollection.findOne({
        bookId: borrowData?.bookId,
        email: borrowData?.email,
      });

      if (findSame) {
        return res.send({ message: "already-borrowed" });
      }

      const result = await borrowedBooksCollection.insertOne(borrowData);

      const currentBook = await booksCollection.findOne({
        _id: new ObjectId(borrowData?.bookId),
      });

      const currentQuantity = await currentBook?.quantity;

      if (currentQuantity <= 0) {
        return res.send({ message: "no-quantity" });
      }

      const reduceQuantity = await booksCollection.updateOne(
        { _id: new ObjectId(borrowData?.bookId) },
        {
          $set: {
            quantity: currentQuantity - 1,
          },
        }
      );

      res.send({ message: "success", result, reduceQuantity });
    });

    app.post("/api/v1/return-book", authenticate, async (req, res) => {
      try {
        const details = req.body;
        const bookId = details.bookId;
        const borrowedId = details.borrowedId;

        const removeBorrowedItem = await borrowedBooksCollection.deleteOne({
          _id: new ObjectId(borrowedId),
        });

        const currentBook = await booksCollection.findOne({
          _id: new ObjectId(bookId),
        });

        const currentQuantity = await currentBook?.quantity;

        const increaseQuantity = await booksCollection.updateOne(
          { _id: new ObjectId(bookId) },
          {
            $set: {
              quantity: currentQuantity + 1,
            },
          }
        );

        res.send({ message: "success" });
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    app.put("/api/v1/edit-book", authenticate, authorize, async (req, res) => {
      try {
        const body = req.body;
        const bookId = body.bookId;
        const bookData = body.bookData;

        const filter = { _id: new ObjectId(bookId) };

        const result = await booksCollection.replaceOne(filter, bookData);

        if (result.acknowledged && result.modifiedCount > 0) {
          res.send({ message: "success" });
        } else {
          res.send({ message: "error" });
        }
      } catch (error) {
        res.status(404).send({ message: "server-error" });
      }
    });

    app.delete(
      "/api/v1/delete-book",
      authenticate,
      authorize,
      async (req, res) => {
        try {
          const bookId = req.query.bookId;

          const query = { _id: new ObjectId(bookId) };

          const deleteBook = await booksCollection.deleteOne(query);

          const filter = { bookId: bookId };

          const clearFromBorrowed = await borrowedBooksCollection.deleteMany(
            filter
          );

          res.send({ message: "success" });
        } catch (error) {
          res.status(404).send({ message: "server-error" });
        }
      }
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from Libratech's server!");
});

app.listen(port, () => {
  console.log(`Libratech server is running on port ${port}`);
});
