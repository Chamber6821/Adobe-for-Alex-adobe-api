import { Browser, Builder, By, Key, until, WebDriver } from "selenium-webdriver"
import fs from 'fs/promises'
import { Options } from "selenium-webdriver/chrome"
import { Token } from "./aliases"

class Eyes {
  private index = 0
  constructor(
    private readonly directory: string,
    private readonly browser: WebDriver
  ) { }
  async look() {
    const id = this.index++
    const formatter = new Intl.NumberFormat('en-US', { minimumIntegerDigits: 2 })
    const filename = `${this.directory}/${formatter.format(id)}.png`
    console.log(`Taking screenshot ${filename}...`)
    const screenshot = await this.browser.takeScreenshot()
    console.log(`Saving screenshot ${filename}...`)
    try { await fs.access(this.directory) }
    catch { await fs.mkdir(this.directory, { recursive: true }) }
    await fs.writeFile(filename, screenshot, { encoding: 'base64' })
  }
}

export default class Selenium {
  constructor(
    public readonly serverUrl: URL,
  ) { }

  async login(email: string, password: string): Promise<Token> {
    return await this.inSession(async browser => {
      const eyes = new Eyes(`./screenshots/${new Date().toISOString()}-login-${email}`, browser)
      await browser.get('https://adminconsole.adobe.com')

      await eyes.look()
      await browser.wait(until.elementLocated(By.id('EmailPage-EmailField')))
      await eyes.look()
      const emailInput = await browser.findElement(By.id('EmailPage-EmailField'))
      await emailInput.sendKeys(email, Key.ENTER)

      await eyes.look()
      await browser.wait(until.stalenessOf(emailInput))
      if (await browser.findElements(By.id('PasswordPage-PasswordField')).then(x => x.length) == 0) {
        await eyes.look()
        const nextButton = await browser.findElement(By.css('.CardLayout .spectrum-Button'))
        await nextButton.click()

        if (await browser.findElements(By.css('*[data-id="ErrorPage-Title"]')).then(x => x.length) > 0)
          throw new Error('New emails temporary deny')
        const code = await this.getMailCode(email, password)

        await eyes.look()
        await browser.wait(until.elementLocated(By.css('*[data-id="CodeInput-0"]')))
        await eyes.look()
        const codeInput = await browser.findElement(By.css('*[data-id="CodeInput-0"]'))
        await codeInput.sendKeys(code)
      }

      await eyes.look()
      await browser.wait(until.elementLocated(By.id('PasswordPage-PasswordField')))
      await eyes.look()
      const passwordInput = await browser.findElement(By.id('PasswordPage-PasswordField'))
      await passwordInput.sendKeys(password, Key.ENTER)

      await eyes.look()
      await browser.wait(until.urlContains('https://adminconsole.adobe.com'))
      await browser.wait(until.elementLocated(By.css('button')))
      await eyes.look()
      return await this.extractToken(browser)
    })
  }

  async register(email: string, password: string): Promise<Token> {
    return await this.inSession(async browser => {
      const eyes = new Eyes(`./screenshots/${new Date().toISOString()}-register-${email}`, browser)
      await browser.get('https://adminconsole.adobe.com')

      await eyes.look()
      await browser.wait(until.elementLocated(By.css('*[data-id="EmailPage-CreateAccountLink"]')))
      await eyes.look()
      await browser.findElement(By.css('*[data-id="EmailPage-CreateAccountLink"]')).then(x => x.click())

      await eyes.look()
      await browser.wait(until.elementLocated(By.css('*[data-id="Signup-EmailField"]')))
      await eyes.look()
      const emailInput = await browser.findElement(By.css('*[data-id="Signup-EmailField"]'))
      const passwordInput = await browser.findElement(By.css('*[data-id="Signup-PasswordField"]'))
      await emailInput.sendKeys(email)
      await passwordInput.sendKeys(password)

      await eyes.look()
      await browser.wait(until.elementLocated(By.css('*[data-id="PasswordStrengthRule-notCommonlyUsed"] img[src="/img/generic/check.svg"]')))
      await eyes.look()
      const continueButton = await browser.findElement(By.css('*[data-id="Signup-CreateAccountBtn"]'))
      await continueButton.click()

      await eyes.look()
      await browser.wait(until.elementLocated(By.css('*[data-id="Signup-FirstNameField"]')), 10000)
      await eyes.look()
      const firstNameInput = await browser.findElement(By.css('*[data-id="Signup-FirstNameField"]'))
      const lastNameInput = await browser.findElement(By.css('*[data-id="Signup-LastNameField"]'))
      const createAccountButton = await browser.findElement(By.css('*[data-id="Signup-CreateAccountBtn"]'))
      await firstNameInput.sendKeys('John')
      await lastNameInput.sendKeys('Cererra')
      await createAccountButton.click()

      await eyes.look()
      await browser.wait(until.urlContains('https://adminconsole.adobe.com'))
      await browser.wait(until.elementLocated(By.css('button')))
      await eyes.look()
      return await this.extractToken(browser)
    })
  }

  private async inSession<T>(script: (browser: WebDriver) => Promise<T>): Promise<T> {
    const browser = await this.browser()
    const timeout = setTimeout(async () => {
      console.warn('Browser session timedout')
      await browser.quit()
    }, 2 * 60 * 1000)
    try {
      return await script(browser)
    } finally {
      clearTimeout(timeout)
      await browser.quit()
    }
  }

  private async browser(): Promise<WebDriver> {
    const options = new Options()
    options.setUserPreferences({
      'profile.default_content_setting_values.images': 2
    })
    const browser = new Builder()
      .forBrowser(Browser.CHROME)
      .setChromeOptions(options)
      .usingServer(this.serverUrl.toString())
      .build()
    return browser
  }

  private async extractToken(browser: WebDriver): Promise<Token> {
    const storage: Record<string, string> = await browser.executeScript(`return window.sessionStorage`)
    const accessKey = Object.keys(storage).filter(x => /adobeid_ims_access_token/.test(x))[0]
    if (!accessKey) {
      console.log('storage', storage)
      throw new Error('Failed to get access key for session storage')
    }
    return JSON.parse(storage[accessKey] || '{}').tokenValue
  }

  private async getMailCode(address: string, password: string): Promise<string> {
    console.log('Email', address, 'Get mail.tm token')
    const mailToken = await fetch('https://api.mail.tm/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ address, password })
    }).then(x => x.json()).then(x => x.token)
    let tries = 10
    while (tries--) {
      const lastMessage: { id: string, seen: boolean, intro: string } | undefined = await fetch('https://api.mail.tm/messages', {
        headers: {
          'Authorization': `Bearer ${mailToken}`,
          'Content-Type': 'application/json',
        }
      }).then(x => x.json()).then(x => x['hydra:member'][0])
      console.log('lastMessage', lastMessage)
      if (!lastMessage || lastMessage.seen) {
        await new Promise(r => setTimeout(r, 3000))
        continue
      }
      const messageUrl = `https://api.mail.tm/messages/${lastMessage.id}`
      await fetch(messageUrl, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${mailToken}`,
          'Content-Type': 'application/merge-patch+json',
        },
        body: JSON.stringify({ seen: true })
      })
      const match = /\d{6}/.exec(lastMessage.intro)
      if (!match) continue
      console.log('Email', address, 'Got code:', match[0])
      return match[0]
    }
    throw new Error('Timed out to wait email with code')
  }
}
