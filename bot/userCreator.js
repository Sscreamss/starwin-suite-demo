// bot/userCreator.js
class UserCreator {
  async create({ name, suffix, fixedPassword }) {
    const clean = (name || "")
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]/g, "");

    const rnd = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
    const username = `${clean}${rnd}${suffix}`;
    const password = fixedPassword;

    // stub: devuelve directo
    return { ok: true, username, password };
  }
}

module.exports = { UserCreator };
