import jwt from 'jsonwebtoken';
import { AuthenticationError, UserInputError } from 'apollo-server';
import { combineResolvers } from 'graphql-resolvers';
import { isAdmin } from './authorization';

const createToken = async (user, secret, expiresIn) => {
  const { id, email, username, role } = user;
  return await jwt.sign({ id, email, username, role }, secret, {
    expiresIn,
  });
};

export default {
  Query: {
    users: async (parent, args, { models }) => {
      return await models.User.findAll();
    },
    user: async (parent, { id }, { models }) => {
      return await models.User.findByPk(id);
    },
    me: async (parent, args, { models, me }) => {
      if (me) {
        return await models.User.findByPk(me.id);
      } else {
        return null;
      }
    },
  },
  Mutation: {
    signUp: async (
      parent,
      { username, password, email },
      { models, secret }
    ) => {
      const user = await models.User.create({
        username,
        password,
        email,
      });
      return {
        token: createToken(user, secret, '1yr'),
        user: user,
      };
    },
    signIn: async (parent, { login, password }, { models, secret }) => {
      const user = await models.User.findByLogin(login);
      if (!user) {
        throw new UserInputError('No user found with this login credentials.');
      }
      const isValid = await user.validatePassword(password);
      if (!isValid) {
        throw new AuthenticationError('Invalid password');
      }
      return {
        token: createToken(user, secret, '1yr'),
        user: user,
      };
    },
    deleteUser: combineResolvers(
      isAdmin,
      async (parent, { id }, { models }) => {
        return await models.User.destroy({
          where: { id },
        });
      }
    ),
  },
  User: {
    messages: async (user, args, { models }) => {
      return await models.Message.findAll({
        where: {
          userId: user.id,
        },
      });
    },
    trackedDays: async (user, args, { models }) => {
      return await models.TrackedDay.findAll({
        where: {
          userId: user.id,
        },
      });
    },
    timesheets: async (user, args, { models }) => {
      return await models.Timesheet.findAll({
        where: {
          userId: user.id,
        },
      });
    },
  },
};
