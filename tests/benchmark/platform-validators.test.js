import { describe, it, expect } from 'vitest';
import { TwitterPlatformResponseValidator } from '../../src/scrapers/social/twitter/validator.js';
import { FacebookPlatformResponseValidator } from '../../src/scrapers/social/facebook/validator.js';
import { ShopeePlatformResponseValidator } from '../../src/scrapers/ecom/shopee/validator.js';
import { FnbPlatformResponseValidator } from '../../src/scrapers/fnb/merchant/validator.js';
import { MaSoThuePlatformResponseValidator } from '../../src/scrapers/procurement/masothue/validator.js';

describe('Story 34.3: Platform-Specific Validators & False-200 Detection (25+ Fixtures)', () => {
  const twitterValidator = new TwitterPlatformResponseValidator();
  const facebookValidator = new FacebookPlatformResponseValidator();
  const shopeeValidator = new ShopeePlatformResponseValidator();
  const fnbValidator = new FnbPlatformResponseValidator();
  const masothueValidator = new MaSoThuePlatformResponseValidator();

  describe('Twitter Validator False-200 Fixtures', () => {
    it('fixture 1: detects Cloudflare interstitial returned with status 200', () => {
      const res = {
        status: 200,
        data: '<html><head><title>Just a moment...</title></head><body>__cf_chl_jschl_tk__</body></html>',
      };
      expect(twitterValidator.isFalse200(res)).toBe(true);
      const diag = twitterValidator.validateResponse(res);
      expect(diag.isValid).toBe(false);
      expect(diag.isFalse200).toBe(true);
      expect(diag.isCheckpoint).toBe(true);
    });

    it('fixture 2: detects Arkose challenge returned with status 200', () => {
      const res = {
        status: 200,
        data: '<html><script src="https://client-api.arkoselabs.com/fc/api/"></script></html>',
      };
      expect(twitterValidator.isFalse200(res)).toBe(true);
      expect(twitterValidator.validateResponse(res).isCheckpoint).toBe(true);
    });

    it('fixture 3: detects rate limit error payload disguised as 200', () => {
      const res = {
        status: 200,
        data: {
          errors: [{ code: 88, message: 'Rate limit exceeded' }],
        },
      };
      expect(twitterValidator.isFalse200(res)).toBe(true);
      expect(twitterValidator.validateResponse(res).isValid).toBe(false);
    });

    it('fixture 4: detects account locked / challenge code 326 disguised as 200', () => {
      const res = {
        status: 200,
        data: {
          errors: [{ code: 326, message: 'To protect our users from spam, account locked' }],
        },
      };
      expect(twitterValidator.isFalse200(res)).toBe(true);
      expect(twitterValidator.isBotChallenge(res)).toBe(true);
    });

    it('fixture 5: detects empty timeline instructions under 200', () => {
      const res = {
        status: 200,
        data: {
          data: {
            user: {
              result: {
                timeline_v2: {
                  timeline: {
                    instructions: [],
                  },
                },
              },
            },
          },
        },
      };
      expect(twitterValidator.isFalse200(res)).toBe(true);
      expect(twitterValidator.validateResponse(res).isValid).toBe(false);
    });

    it('fixture 6: recognizes valid GraphQL timeline response', () => {
      const res = {
        status: 200,
        data: {
          data: {
            user: {
              result: {
                timeline_v2: {
                  timeline: {
                    instructions: [{ type: 'TimelineAddEntries', entries: [{ entryId: 'tweet-1' }] }],
                  },
                },
              },
            },
          },
        },
      };
      expect(twitterValidator.isFalse200(res)).toBe(false);
      const diag = twitterValidator.validateResponse(res);
      expect(diag.isValid).toBe(true);
      expect(diag.isFalse200).toBe(false);
      expect(diag.isCheckpoint).toBe(false);
    });

    it('fixture 6b: detects TweetTombstone disguised as 200', () => {
      const res = {
        status: 200,
        data: {
          data: {
            tweetResult: {
              result: {
                __typename: 'TweetTombstone',
                tombstone: { text: { text: 'This tweet was deleted' } },
              },
            },
          },
        },
      };
      expect(twitterValidator.isFalse200(res)).toBe(true);
      expect(twitterValidator.validateResponse(res).isValid).toBe(false);
    });

    it('fixture 6c: detects nested GraphQL errors in data.errors with code 353', () => {
      const res = {
        status: 200,
        data: {
          data: { user: {} },
          errors: [{ code: 353, message: 'Flooding limit exceeded' }],
        },
      };
      expect(twitterValidator.isFalse200(res)).toBe(true);
      expect(twitterValidator.validateResponse(res).isValid).toBe(false);
    });
  });

  describe('Facebook Validator False-200 Fixtures', () => {
    it('fixture 7: detects /checkpoint/ redirection under 200', () => {
      const res = {
        status: 200,
        url: 'https://www.facebook.com/checkpoint/?next=https%3A%2F%2Fwww.facebook.com%2F',
        data: '<html>Checkpoint checkpoint redirect</html>',
      };
      expect(facebookValidator.isFalse200(res)).toBe(true);
      const diag = facebookValidator.validateResponse(res);
      expect(diag.isCheckpoint).toBe(true);
      expect(diag.isValid).toBe(false);
    });

    it('fixture 8: detects password login form under 200', () => {
      const res = {
        status: 200,
        data: '<html><form><input type="text" name="email"/><input type="password" name="pass"/></form></html>',
      };
      expect(facebookValidator.isFalse200(res)).toBe(true);
      expect(facebookValidator.isLoginWall(res)).toBe(true);
    });

    it('fixture 9: detects login wall phrase "Log in to Facebook" under 200', () => {
      const res = {
        status: 200,
        data: '<html><head><title>Facebook - Log In or Sign Up</title></head><body>Log in to Facebook</body></html>',
      };
      expect(facebookValidator.isFalse200(res)).toBe(true);
      expect(facebookValidator.validateResponse(res).isCheckpoint).toBe(true);
    });

    it('fixture 10: detects empty anti-hijack prefix for (;;); under 200', () => {
      const res = {
        status: 200,
        data: 'for (;;);',
      };
      expect(facebookValidator.isFalse200(res)).toBe(true);
      expect(facebookValidator.validateResponse(res).isValid).toBe(false);
    });

    it('fixture 11: recognizes valid HTML payload with DTSGInitialData and data-ft', () => {
      const res = {
        status: 200,
        data: '<html><script>DTSGInitialData = { token: "abc" };</script><div data-ft="story">Valid Post</div></html>',
      };
      expect(facebookValidator.isFalse200(res)).toBe(false);
      const diag = facebookValidator.validateResponse(res);
      expect(diag.isValid).toBe(true);
      expect(diag.isFalse200).toBe(false);
    });

    it('fixture 11b: detects temporary action blocked code 368 under 200', () => {
      const res = {
        status: 200,
        data: {
          error: {
            message: 'You are temporarily blocked from performing this action',
            code: 368,
          },
        },
      };
      expect(facebookValidator.isFalse200(res)).toBe(true);
      expect(facebookValidator.isRateLimit(res)).toBe(true);
    });
  });

  describe('Shopee Validator False-200 Fixtures', () => {
    it('fixture 12: detects WAF error code 90309999 under status 200', () => {
      const res = {
        status: 200,
        data: {
          error: 90309999,
          error_msg: 'WAF challenge required',
        },
      };
      expect(shopeeValidator.isFalse200(res)).toBe(true);
      const diag = shopeeValidator.validateResponse(res);
      expect(diag.isValid).toBe(false);
      expect(diag.isFalse200).toBe(true);
    });

    it('fixture 13: detects captcha requirement in error_msg under 200', () => {
      const res = {
        status: 200,
        data: {
          error: -1,
          error_msg: 'Please slide to solve captcha verification',
        },
      };
      expect(shopeeValidator.isFalse200(res)).toBe(true);
      expect(shopeeValidator.isBotChallenge(res)).toBe(true);
    });

    it('fixture 14: detects Cloudflare Turnstile HTML on Shopee under 200', () => {
      const res = {
        status: 200,
        data: '<html><title>Shopee | Access Denied</title>cf-browser-verification</html>',
      };
      expect(shopeeValidator.isFalse200(res)).toBe(true);
      expect(shopeeValidator.validateResponse(res).isCheckpoint).toBe(true);
    });

    it('fixture 15: detects rate limit phrase in Shopee response under 200', () => {
      const res = {
        status: 200,
        data: '{"error": 1, "message": "too many requests, please slow down"}',
      };
      expect(shopeeValidator.isFalse200(res)).toBe(true);
      expect(shopeeValidator.isRateLimit(res)).toBe(true);
    });

    it('fixture 16: recognizes valid product items array payload', () => {
      const res = {
        status: 200,
        data: {
          items: [{ item_basic: { itemid: 12345, name: 'Tai nghe Bluetooth' } }],
          total_count: 1,
        },
      };
      expect(shopeeValidator.isFalse200(res)).toBe(false);
      const diag = shopeeValidator.validateResponse(res);
      expect(diag.isValid).toBe(true);
      expect(diag.isFalse200).toBe(false);
    });

    it('fixture 16b: detects empty items array under 200', () => {
      const res = {
        status: 200,
        data: {
          items: [],
          total_count: 0,
        },
      };
      expect(shopeeValidator.isFalse200(res)).toBe(true);
      expect(shopeeValidator.validateResponse(res).isValid).toBe(false);
    });

    it('fixture 16c: detects empty nested data.items array under 200', () => {
      const res = {
        status: 200,
        data: {
          data: {
            items: [],
          },
        },
      };
      expect(shopeeValidator.isFalse200(res)).toBe(true);
      expect(shopeeValidator.validateResponse(res).isValid).toBe(false);
    });
  });

  describe('PasGo / F&B Validator False-200 Fixtures', () => {
    it('fixture 17: detects Cloudflare challenge page on PasGo under 200', () => {
      const res = {
        status: 200,
        data: '<html><title>Just a moment...</title>__cf_chl_jschl_tk__</html>',
      };
      expect(fnbValidator.isFalse200(res)).toBe(true);
      const diag = fnbValidator.validateResponse(res);
      expect(diag.isCheckpoint).toBe(true);
      expect(diag.isValid).toBe(false);
    });

    it('fixture 18: detects empty HTML body (<50 characters) under 200', () => {
      const res = {
        status: 200,
        data: '<html><body></body></html>',
      };
      expect(fnbValidator.isFalse200(res)).toBe(true);
      expect(fnbValidator.isValidPayload(res)).toBe(false);
    });

    it('fixture 19: detects generic login wall on F&B portal under 200', () => {
      const res = {
        status: 200,
        data: '<html><title>Đăng nhập tài khoản</title><div>Vui lòng đăng nhập để tiếp tục</div></html>',
      };
      expect(fnbValidator.isFalse200(res)).toBe(true);
      expect(fnbValidator.isLoginWall(res)).toBe(true);
    });

    it('fixture 20: detects HTML with no F&B markers or schema under 200', () => {
      const res = {
        status: 200,
        data: '<html><head><title>General Portal</title></head><body>This is a generic empty news portal with no restaurant information.</body></html>',
      };
      expect(fnbValidator.isFalse200(res)).toBe(false); // Valid HTML length > 50 and not challenge
      expect(fnbValidator.isValidPayload(res)).toBe(false); // But invalid payload (missing F&B data)
    });

    it('fixture 21: recognizes valid PasGo page with JSON-LD schema.org/restaurant', () => {
      const res = {
        status: 200,
        data: '<html><script type="application/ld+json">{"@type": "schema.org/restaurant", "name": "Nhà hàng Lẩu Nướng"}</script></html>',
      };
      expect(fnbValidator.isFalse200(res)).toBe(false);
      const diag = fnbValidator.validateResponse(res);
      expect(diag.isValid).toBe(true);
      expect(diag.isFalse200).toBe(false);
    });

    it('fixture 22: recognizes valid F&B page with corroborating Vietnamese food terms', () => {
      const res = {
        status: 200,
        data: '<html><head><title>Quán ăn ngon</title></head><body>Thực đơn các món ăn lẩu và nướng hấp dẫn.</body></html>',
      };
      expect(fnbValidator.isFalse200(res)).toBe(false);
      expect(fnbValidator.isValidPayload(res)).toBe(true);
    });

    it('fixture 22b: navbar login link does not trigger login wall', () => {
      const res = {
        status: 200,
        data: '<html><header><a href="/login">Đăng nhập</a></header><body><script type="application/ld+json">{"@type": "schema.org/restaurant", "name": "Quán Cơm"}</script></body></html>',
      };
      expect(fnbValidator.isLoginWall(res)).toBe(false);
      expect(fnbValidator.isFalse200(res)).toBe(false);
      expect(fnbValidator.isValidPayload(res)).toBe(true);
    });
  });

  describe('MaSoThue Validator False-200 Fixtures', () => {
    it('fixture 23: detects Cloudflare verify you are human interstitial under 200', () => {
      const res = {
        status: 200,
        data: '<html><title>Just a moment</title><div>verify you are human</div></html>',
      };
      expect(masothueValidator.isFalse200(res)).toBe(true);
      expect(masothueValidator.validateResponse(res).isCheckpoint).toBe(true);
    });

    it('fixture 24: detects missing company records and table-taxpayer under 200', () => {
      const res = {
        status: 200,
        data: '<html><head><title>Portal</title></head><body>Something went wrong with your query, no data found.</body></html>',
      };
      expect(masothueValidator.isFalse200(res)).toBe(true);
      expect(masothueValidator.validateResponse(res).isValid).toBe(false);
    });

    it('fixture 25: detects empty HTML body (< 50 chars) under 200', () => {
      const res = {
        status: 200,
        data: '<html></html>',
      };
      expect(masothueValidator.isFalse200(res)).toBe(true);
      expect(masothueValidator.isValidPayload(res)).toBe(false);
    });

    it('fixture 25b: detects error page containing masothue.com in footer but missing tax tables', () => {
      const res = {
        status: 200,
        data: '<html><body>Error: requested page was not found on our server.<footer>masothue.com - All rights reserved</footer></body></html>',
      };
      expect(masothueValidator.isFalse200(res)).toBe(true);
      expect(masothueValidator.isValidPayload(res)).toBe(false);
    });

    it('fixture 26: recognizes valid MaSoThue company profile HTML', () => {
      const res = {
        status: 200,
        data: '<html><table class="table-taxpayer"><tr><td>Mã số thuế</td><td>0101234567</td></tr><tr><td>Tên công ty</td><td>Doanh nghiệp X</td></tr></table></html>',
      };
      expect(masothueValidator.isFalse200(res)).toBe(false);
      const diag = masothueValidator.validateResponse(res);
      expect(diag.isValid).toBe(true);
      expect(diag.isFalse200).toBe(false);
    });
  });
});
