const timeBlock = (sequelize, DataTypes) => {
  const TimeBlock = sequelize.define('timeblock', {
    startTime: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: { notEmpty: true },
    },
  });

  TimeBlock.associate = (models) => {
    TimeBlock.belongsTo(models.TrackedTask);
  };
  return TimeBlock;
};
export default timeBlock;
