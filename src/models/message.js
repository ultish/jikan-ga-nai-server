const message = (sequelize, DataTypes) => {
  const Message = sequelize.define(
    "message",
    {
      text: {
        type: DataTypes.STRING,
        validate: { notEmpty: true },
      },
    },
    {
      indexes: [
        {
          fields: ["userId"],
        },
      ],
    }
  );

  Message.associate = (models) => {
    Message.belongsTo(models.User, { onDelete: "CASCADE", hook: true });
  };

  return Message;
};
export default message;
