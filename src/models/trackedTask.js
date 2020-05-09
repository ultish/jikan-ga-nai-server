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
      ],
    }
  );

  TrackedTask.associate = (models) => {
    TrackedTask.hasMany(models.TimeBlock, { onDelete: "CASCADE" });
    TrackedTask.belongsToMany(models.ChargeCode, { through: "taskcodes" });
    TrackedTask.belongsTo(models.TrackedDay);
    // TrackedTask.belongsTo(models.Timesheet);
  };

  return TrackedTask;
};
export default trackedTask;
