import Sequelize from 'sequelize';

export const batchUsers = async (keys, models) => {
  const users = await models.User.findAll({
    where: {
      id: {
        [Sequelize.Op.in]: keys,
        // note in sequelize v5? this can also just be where: { id: keys }
      },
    },
  });
  return keys.map(key => users.find(user => user.id === key));
};
