const trackedDay = (sequelize, DataTypes) => {
  const TrackedDay = sequelize.define(
    "trackedday",
    {
      date: {
        type: DataTypes.DATE,
        allowNull: false,
        unique: true,
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
    },
    {
      indexes: [
        {
          fields: ["userId"],
        },
        {
          fields: ["timesheetId"],
        },
      ],
    }
  );

  TrackedDay.associate = (models) => {
    TrackedDay.hasMany(models.TrackedTask);
    TrackedDay.belongsTo(models.User, { onDelete: "CASCADE", hook: true });
    TrackedDay.hasMany(models.TimeCharge);
  };

  return TrackedDay;
};
export default trackedDay;
