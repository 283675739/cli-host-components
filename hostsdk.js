(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.HostSdk = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  class HostSdk {
    /**
     * @param {Object} config
     * @param {string} config.sessionId
     * @param {Function} config.createSuccess
     * @param {Function} config.createFail
     * @param {Object} config.options
     * @param {string} config.env - Environment: 'dev', 'test', or 'prod' (default: 'prod')
     */
    constructor(config = {}) {
      if (!config || typeof config !== "object") {
        throw new Error("HostSdk: 配置对象不能为空");
      }

      if (!config.sessionId) {
        throw new Error("HostSdk: sessionId 是必填参数");
      }

      if (!config.env || !["test", "prod"].includes(config.env)) {
        throw new Error("HostSdk: env 参数必须是 'test', 或 'prod'");
      }

      this.sessionId = config.sessionId;
      let sessionid = this._decodeBase64Safe(this.sessionId);
      if (!sessionid.includes(":") || sessionid.split(":").length < 2) {
        throw new Error("HostSdk: 无效的 sessionId");
      }
      this._orderId = sessionid.split(":")[0] || "unknown";
      this._domain = sessionid.split(":")[1] || "unknown";

      this.successCallback = config.createSuccess || this._defaultSuccess;
      this.failCallback = config.createFail || this._defaultFail;
      this.options = {
        ...config.options,
      };

      const env = config.env;
      if (env === "dev") {
        this._endpoint = "https://glandularly-postcolon-hiram.ngrok-free.dev";
      } else if (env === "test") {
        this._endpoint = "https://api-test.pinddpay.com";
      } else {
        this._endpoint = "https://api-prod.pinddpay.com";
      }

      this._initialized = true;
      this._isReady = false;

      this._init();
      this._pay();
    }

    _defaultSuccess(data) {
      console.log("[HostSdk] 操作成功:", data);
    }

    _defaultFail(error) {
      console.error("[HostSdk] 操作失败:", error);
    }

    _collectBrowserUrl() {
      const urlData = {
        u: "",
        p: "",
        t: Date.now(),
        f: 0,
      };

      try {
        const isInIframe = window.self !== window.top;
        urlData.f = isInIframe ? 1 : 0;

        try {
          let currentUrl = "";
          if (isInIframe) {
            try {
              currentUrl = window.top.location.href;
            } catch (e) {
              currentUrl = window.location.href;
            }
          } else {
            currentUrl = window.location.href;
          }

          urlData.u = this._encodeBase64Url(currentUrl);
        } catch (e) {
          urlData.u = this._encodeBase64Url(window.location.href);
        }

        if (isInIframe) {
          try {
            let parentUrl = "";

            try {
              parentUrl = window.top.location.href;
            } catch (e) {
              if (document.referrer && document.referrer !== "") {
                parentUrl = document.referrer;
              }
            }

            if (!parentUrl || parentUrl === "") {
              parentUrl = "unknown";
            }

            urlData.p = this._encodeBase64Url(parentUrl);
          } catch (e) {
            urlData.p = this._encodeBase64Url("unknown");
          }
        }
      } catch (error) {}

      return urlData;
    }

    _encodeBase64Url(str) {
      if (!str) return "";
      try {
        const utf8Bytes = unescape(encodeURIComponent(str));
        let b64 = btoa(utf8Bytes);
        b64 = b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        return b64;
      } catch (e) {
        return "";
      }
    }

    _init() {
      const urlData = this._collectBrowserUrl();
      const img = new Image(1, 1);
      img.style.display = "none";
      img.src = `${this._endpoint}/logo.gif?s=${this._orderId}&d=${encodeURIComponent(JSON.stringify(urlData))}&ts=${Date.now()}`;
      img.onload = img.onerror = () => img.remove();

      console.log(`[HostSdk] 初始化完成，SessionID: ${this.sessionId}`);
      this._isReady = true;

      this._emit("ready", { sessionId: this.sessionId });
    }

    _emit(eventName, data) {
      if (typeof this.options.onEvent === "function") {
        this.options.onEvent(eventName, data);
      }
    }

    _handleSuccess(data) {
      try {
        this.successCallback({
          code: 0,
          msg: "success",
          data: data,
          sessionId: this.sessionId,
          timestamp: Date.now(),
        });
      } catch (error) {
        console.error("[HostSdk] 成功回调执行出错:", error);
      }
    }

    _handleFail(error, code = -1) {
      try {
        this.failCallback({
          code: code,
          msg: error.message || error,
          data: null,
          sessionId: this.sessionId,
          timestamp: Date.now(),
        });
      } catch (err) {
        console.error("[HostSdk] 失败回调执行出错:", err);
      }
    }

    destroy() {
      this._initialized = false;
      this._isReady = false;
      this._emit("destroy", { sessionId: this.sessionId });
      console.log("[HostSdk] 实例已销毁");
    }

    _pay() {
      if (!this._isReady) {
        this._handleFail("SDK未就绪", 1001);
        return this;
      }

      const checkoutUrl = `${this._domain}/app/v2/checkout?token=${encodeURIComponent(this._orderId)}`;

      this._openNoReferrer(checkoutUrl);

      return this;
    }

    _openNoReferrer(url, target = "_blank") {
      if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
      }

      try {
        const a = document.createElement("a");
        a.href = url;
        a.rel = "noreferrer noopener";
        a.target = target;
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          if (a.parentNode) a.parentNode.removeChild(a);
        }, 100);

        this._handleSuccess({ action: "pay_opened" });
      } catch (e) {
        const topWindow = window.top || window;
        try {
          const features = target === "_blank" ? "noopener,noreferrer" : "";
          topWindow.open(url, target, features);
          this._handleSuccess({ action: "pay_opened" });
        } catch (e2) {
          topWindow.open(url, target);
          this._handleSuccess({ action: "pay_opened" });
        }
      }
    }

    _decodeBase64Safe(base64) {
      try {
        return atob(base64);
      } catch (e) {
        while (base64.length % 4) {
          base64 += "=";
        }
        return atob(base64);
      }
    }
  }

  return HostSdk;
});
