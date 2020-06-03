import express from "express";
import jwt from "jsonwebtoken";
import { ApolloServer, AuthenticationError } from "apollo-server-express";
import http from "http";
import DataLoader from "dataloader";
import loaders from "./loaders";

// must import this before any uses of process.ENV
import "dotenv/config";

import schema from "./schema";
import resolvers from "./resolvers";
import models, { sequelize } from "./models";

import cors from "cors";

const getMe = async (req) => {
  const token = req.headers["x-token"];

  // console.log('Headers', req.headers);

  if (token) {
    try {
      return await jwt.verify(token, process.env.SECRET);
    } catch (e) {
      console.log(e);
      throw new AuthenticationError("Your session expired. Sign in again.");
    }
  }
};

// this *fakes* caching and will return the same User objects back once they
// appear in the dataloader instance. I say fake as it has no expiry strategy
// so you always get the same User object back.
// const userLoader = new DataLoader(keys => batchUsers(keys, models));

const app = express();
app.use(cors());
// host static files from public dir
app.use(express.static("public"));

const server = new ApolloServer({
  typeDefs: schema,
  resolvers,
  playground: {
    cdnUrl: "/static",
  },
  context: async ({ req, connection }) => {
    if (connection) {
      return {
        models,
        loaders: {
          user: new DataLoader((keys) => loaders.user.batchUsers(keys, models)),
        },
      };
    }
    if (req) {
      const me = await getMe(req);

      return {
        models,
        me,
        secret: process.env.SECRET,
        loaders: {
          user: new DataLoader((keys) => loaders.user.batchUsers(keys, models)),
        },
      };
    }
  },
});
server.applyMiddleware({ app, path: "/graphql" });

const httpServer = http.createServer(app);
server.installSubscriptionHandlers(httpServer);

// Warning: turning this on will clear your DB
console.log("sync db", process.env.SYNC_DB);
const eraseDatabaseOnSync = process.env.SYNC_DB === "true" || false;

console.log("erase db? " + eraseDatabaseOnSync);
sequelize.sync({ force: eraseDatabaseOnSync }).then(async () => {
  if (eraseDatabaseOnSync) {
    console.log("resetting database");
    createUsersWithMessages(new Date());
  }
});

httpServer.listen({ port: 9998 }, () => {
  console.log("Apollo Server on http://localhost:9998/graphql");
});

const createUsersWithMessages = async (date) => {
  // await models.User.create(
  //   {
  //     username: "test",
  //     email: "test@world.com",
  //     password: "password",
  //     role: "ADMIN",
  //     messages: [
  //       {
  //         text: "Published the Road to learn React",
  //         createdAt: date.setSeconds(date.getSeconds() + 1),
  //       },
  //     ],
  //   },
  //   {
  //     include: [models.Message],
  //   }
  // );
  await models.User.create({
    username: "jxhui",
    email: "hui@project.com",
    password: "password",
    role: "ADMIN",
  });

  await models.ChargeCode.create({
    name: "Local",
    code: "Local",
    description: "Local Support",
    expired: false,
  });
  await models.ChargeCode.create({
    name: "Remote",
    code: "Remote",
    description: "Remote Support",
    expired: false,
  });
  await models.ChargeCode.create({
    name: "556",
    code: "556",
    description: "556 Development",
    expired: false,
  });
  await models.ChargeCode.create({
    name: "Annual Leave",
    code: "HOL_ANNUAL",
    description: "Annual Leave",
    expired: false,
  });
  await models.ChargeCode.create({
    name: "Personal",
    code: "HOL_PERSONAL",
    description: "Personal Leave",
    expired: false,
  });
  await models.ChargeCode.create({
    name: "RDO",
    code: "HOL_RDO",
    description: "RDO",
    expired: false,
  });
  await models.ChargeCode.create({
    name: "Public Holiday",
    code: "HOL_PUBLIC",
    description: "Public Holiday",
    expired: false,
  });
};
