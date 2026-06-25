export const Settings = {

  url: "https://bluebootapi-nouhm5zjqa-uc.a.run.app",
  publicApiUrl() {
    return this.url
  },
  setPublicUrl(env?: string | undefined) {
    if (env?.toLowerCase() == "prod") {
      this.url = "https://bluebootapi-nouhm5zjqa-uc.a.run.app"
    } else if (env?.toLowerCase() == "dev") {
      this.url = "https://bluebootapi-cv5uqudw3q-uc.a.run.app"
    } else if (env?.toLowerCase() == "local") {
      this.url = "http://localhost:8085"
    } else if (env?.toLowerCase() == "dev-local") {
      this.url = '../environments/environment'
    } else {
      this.url = "https://bluebootapi-nouhm5zjqa-uc.a.run.app"
    }
    console.log(env + this.url)
  },
  queryBase() {
    return this.publicApiUrl()
  }
}
