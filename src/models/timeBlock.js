const timeBlock = (sequelize, DataTypes) => {
  const TimeBlock = sequelize.define(
    "timeblock",
    {
      startTime: {
        type: DataTypes.DATE,
        allowNull: false,
        validate: { notEmpty: true },
      },
    },
    {
      indexes: [
        {
          unique: true,
          fields: ["startTime", "trackedtaskId", "userId"],
        },
        {
          fields: ["trackedtaskId"],
        },
        {
          fields: ["userId"],
        },
      ],
    }
  );

  TimeBlock.associate = (models) => {
    TimeBlock.belongsTo(models.TrackedTask, {
      onDelete: "CASCADE",
      hooks: true,
    });
    TimeBlock.belongsTo(models.User);
  };
  return TimeBlock;
};
export default timeBlock;
