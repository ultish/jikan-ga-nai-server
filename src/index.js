import express from 'express';
import jwt from 'jsonwebtoken';
import { ApolloServer, AuthenticationError } from 'apollo-server-express';
import http from 'http';
import DataLoader from 'dataloader';
import loaders from './loaders';

// must import this before any uses of process.ENV
import 'dotenv/config';

import schema from './schema';
import resolvers from './resolvers';
import models, { sequelize } from './models';

import cors from 'cors';

const getMe = async (req) => {
  const token = req.headers['x-token'];

  console.log('Headers', req.headers);

  if (token) {
    try {
      return await jwt.verify(token, process.env.SECRET);
    } catch (e) {
      console.log(e);
      throw new AuthenticationError('Your session expired. Sign in again.');
    }
  }
};

// this *fakes* caching and will return the same User objects back once they
// appear in the dataloader instance. I say fake as it has no expiry strategy
// so you always get the same User object back.
// const userLoader = new DataLoader(keys => batchUsers(keys, models));

const app = express();
app.use(cors());

const server = new ApolloServer({
  typeDefs: schema,
  resolvers,
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
      debugger;
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
server.applyMiddleware({ app, path: '/graphql' });

const httpServer = http.createServer(app);
server.installSubscriptionHandlers(httpServer);

const eraseDatabaseOnSync = true;
sequelize.sync({ force: eraseDatabaseOnSync }).then(async () => {
  if (eraseDatabaseOnSync) {
    createUsersWithMessages(new Date());
  }
  httpServer.listen({ port: 8000 }, () => {
    console.log('Apollo Server on http://localhost:8000/graphql');
  });
});

const createUsersWithMessages = async (date) => {
  await models.User.create(
    {
      username: 'rwieruch',
      email: 'hello@robin.com',
      password: 'rwieruch',
      role: 'ADMIN',
      messages: [
        {
          text: 'Published the Road to learn React',
          createdAt: date.setSeconds(date.getSeconds() + 1),
        },
      ],
    },
    {
      include: [models.Message],
    }
  );
  await models.User.create(
    {
      username: 'jxhui',
      email: 'hello@david.com',
      password: 'password',
      messages: [
        {
          text: 'Happy to release...',
          createdAt: date.setSeconds(date.getSeconds() + 1),
        },
        {
          text: 'Published a complete...',
          createdAt: date.setSeconds(date.getSeconds() + 1),
        },
      ],
    },
    {
      include: [models.Message],
    }
  );
};
