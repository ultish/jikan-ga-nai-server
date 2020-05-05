const timesheet = (sequelize, DataTypes) => {
  const Timesheet = sequelize.define('timesheet', {
    weekEndingDate: {
      type: DataTypes.DATE,
      allowNull: false,
      validate: { notEmpty: true },
    },
  });

  Timesheet.associate = (models) => {
    Timesheet.belongsTo(models.User);
    Timesheet.hasMany(models.TimeCharge, { onDelete: 'CASCADE' });
    Timesheet.hasMany(models.TrackedDay);
  };

  return Timesheet;
};
export default timesheet;
