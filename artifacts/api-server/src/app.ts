import express, { type Express } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import cors from "cors";
import session from "express-session";
import MongoStore from "connect-mongo";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { getMongoClient, getMongoDatabaseName } from "./lib/mongo";

const app: Express = express();

app.set("trust proxy", 1);
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0]?.replace(
            /(\/installation\/share\/)[a-f0-9]{64}/g,
            "$1[redacted]",
          ),
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));
app.use(
  session({
    name: "upvc.sid",
    secret: process.env.SESSION_SECRET!,
    store: MongoStore.create({
      clientPromise: getMongoClient(),
      dbName: getMongoDatabaseName(),
      collectionName: "sessions",
      ttl: 8 * 60 * 60,
    }),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: "auto",
      maxAge: 8 * 60 * 60 * 1000,
    },
  }),
);

app.use("/api", router);

if (process.env.NODE_ENV === "production") {
  const frontendDirectory = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../upvc-order-management/dist/public",
  );

  app.use(express.static(frontendDirectory));
  app.use((req, res, next) => {
    if (
      req.method !== "GET" ||
      req.path === "/api" ||
      req.path.startsWith("/api/") ||
      path.extname(req.path)
    ) {
      next();
      return;
    }

    res.sendFile(path.join(frontendDirectory, "index.html"), (error) => {
      if (error) next(error);
    });
  });
}

export default app;
