const trackedTask = (sequelize, DataTypes) => {
  const TrackedTask = sequelize.define(
    "trackedtask",
    {
      notes: {
        type: DataTypes.STRING,
      },
      overtimeEnabled: {
        type: DataTypes.BOOLEAN,
      },
    },
    {
      indexes: [
        {
          fields: ["trackeddayId"],
        },
        {
          fields: ["userId"],
        },
      ],
    }
  );

  TrackedTask.associate = (models) => {
    TrackedTask.hasMany(models.TimeBlock, { onDelete: "CASCADE", hooks: true });
    TrackedTask.belongsToMany(models.ChargeCode, { through: "taskcodes" });
    TrackedTask.belongsTo(models.TrackedDay);
    TrackedTask.belongsTo(models.User);
  };

  return TrackedTask;
};
export default trackedTask;
