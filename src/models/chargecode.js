const chargecode = (sequelize, DataTypes) => {
  const ChargeCode = sequelize.define("chargecode", {
    name: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    code: {
      type: DataTypes.STRING,
      unique: true,
      allowNull: false,
      validate: {
        notEmpty: true,
      },
    },
    description: {
      type: DataTypes.STRING,
    },
    expired: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
    },
  });

  ChargeCode.associate = (models) => {
    ChargeCode.belongsToMany(models.TrackedTask, { through: "taskcodes" });
  };

  return ChargeCode;
};
export default chargecode;
