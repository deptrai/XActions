declare module 'selenium-webdriver' {
  export interface Cookie {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
  }

  export class By {
    static css(selector: string): By;
  }

  export interface Condition<T = unknown> {
    (driver: WebDriver): Promise<T> | T;
  }

  export namespace until {
    function elementLocated(locator: By): Condition<WebElement>;
  }

  export class WebElement {
    getText(): Promise<string>;
  }

  export class WebDriver {
    manage(): {
      window(): { setRect(rect: { width?: number; height?: number }): Promise<void> };
      addCookie(cookie: Cookie): Promise<void>;
    };
    switchTo(): {
      window(handle: string): Promise<void>;
      newWindow(type: 'tab' | 'window'): Promise<void>;
    };
    get(url: string): Promise<void>;
    executeScript<T = unknown>(script: string, ...args: unknown[]): Promise<T>;
    executeAsyncScript<T = unknown>(script: string, ...args: unknown[]): Promise<T>;
    findElements(locator: By): Promise<WebElement[]>;
    getPageSource(): Promise<string>;
    takeScreenshot(): Promise<string>;
    wait<T = unknown>(condition: Condition<T> | ((driver: WebDriver) => T | Promise<T>), timeout?: number): Promise<T>;
    getWindowHandle(): Promise<string>;
    getAllWindowHandles(): Promise<string[]>;
    close(): Promise<void>;
    quit(): Promise<void>;
  }

  export class Builder {
    forBrowser(name: string): Builder;
    usingServer(url: string): Builder;
    setChromeOptions(options: chrome.Options): Builder;
    setFirefoxOptions(options: firefox.Options): Builder;
    build(): WebDriver;
  }

  export namespace chrome {
    class Options {
      addArguments(...args: string[]): Options;
      excludeSwitches(...switches: string[]): Options;
    }
  }

  export namespace firefox {
    class Options {
      addArguments(...args: string[]): Options;
      setPreference(name: string, value: unknown): Options;
    }
  }

  export const Capabilities: unknown;
}

declare module 'selenium-webdriver/chrome.js' {
  export class Options {
    addArguments(...args: string[]): Options;
    excludeSwitches(...switches: string[]): Options;
  }
}

declare module 'selenium-webdriver/firefox.js' {
  export class Options {
    addArguments(...args: string[]): Options;
    setPreference(name: string, value: unknown): Options;
  }
}
