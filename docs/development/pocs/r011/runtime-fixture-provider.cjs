module.exports = class RuntimeFixtureProvider {
  id() {
    return "r011-runtime-fixture";
  }

  async callApi(prompt) {
    return { output: prompt };
  }
};
