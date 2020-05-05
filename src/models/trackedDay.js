const trackedDay = (sequelize, DataTypes) => {
  const TrackedDay = sequelize.define('trackedday', {
    date: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    mode: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
  });

  TrackedDay.associate = (models) => {
    TrackedDay.hasMany(models.TrackedTask, { onDelete: 'CASCADE' });
    TrackedDay.belongsTo(models.User);
    TrackedDay.hasMany(models.TimeCharge, { onDelete: 'CASCADE' });
  };

  return TrackedDay;
};
export default trackedDay;
