const trackedTask = (sequelize, DataTypes) => {
  const TrackedTask = sequelize.define('trackedtask', {
    notes: {
      type: DataTypes.STRING,
    },
  });

  TrackedTask.associate = (models) => {
    TrackedTask.hasMany(models.TimeBlock, { onDelete: 'CASCADE' });
    TrackedTask.belongsToMany(models.ChargeCode, { through: 'taskcodes' });
    TrackedTask.belongsTo(models.TrackedDay);
  };

  return TrackedTask;
};
export default trackedTask;