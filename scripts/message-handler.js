// Message handling functionality for iframe communication
class MessageHandler {
  constructor(parentOrigin = 'http://localhost:5173') {
    this.parentOrigin = parentOrigin;
    this.init();
  }

  init() {
    window.addEventListener('message', (event) => {
      this.handleMessage(event);
    });
  }

  handleMessage(event) {
    // Only accept messages from the expected parent and origin
    if (event.source !== window.parent) return;
    if (event.origin !== this.parentOrigin) return;

    const data = event.data;
    if (!data || typeof data !== 'object') return;

    const type = data.type;

    switch (type) {
      case 'html-to-json-result':
        this.handleHtmlToJsonResult(data.payload);
        break;
      case 'request-html-to-json':
        this.handleHtmlToJsonRequest(event.origin);
        break;
      default:
        console.log('Unknown message type:', type);
    }
  }

  handleHtmlToJsonResult(payload) {
    try {
      const summary = this.summarizePayload(payload);
      console.info('[MessageHandler] html-to-json-result received', summary);
    } catch {
      console.warn('[MessageHandler] Failed to log html-to-json-result');
    }
  }

  handleHtmlToJsonRequest(origin) {
    console.info('[MessageHandler] request-html-to-json received', {
      at: new Date().toISOString(),
      url: window.location.href,
      origin: origin
    });

    // Handle HTML to JSON conversion request
    setTimeout(() => {
      const payload = this.getConversionPayload();
      if (payload != null) {
        try {
          window.parent.postMessage(
            { type: 'html-to-json-result', payload },
            origin
          );
          console.info('[MessageHandler] posted html-to-json-result to parent');
        } catch {
          console.warn('[MessageHandler] failed to post html-to-json-result');
        }
      }
    }, 800);
  }

  sendMessage(type, data) {
    const message = {
      type: type,
      ...data,
      timestamp: Date.now()
    };

    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage(message, this.parentOrigin);
      }
    } catch (error) {
      console.warn('Failed to send message:', error);
    }
  }

  summarizePayload(payload) {
    try {
      if (payload == null) return payload;
      if (typeof payload === 'string') {
        return payload.length > 500 ? payload.slice(0, 500) + '…' : payload;
      }
      if (Array.isArray(payload)) {
        return { kind: 'array', length: payload.length, sample: payload.slice(0, 3) };
      }
      if (typeof payload === 'object') {
        const keys = Object.keys(payload);
        const sample = {};
        for (const k of keys.slice(0, 10)) {
          const v = payload[k];
          sample[k] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
        }
        return { kind: 'object', keys: keys.length, sample };
      }
      return payload;
    } catch {
      return '[unserializable payload]';
    }
  }

  getConversionPayload() {
    const globals = [
      '__HTML_TO_JSON__',
      '__htmlToJson__',
      '__htmlToJson',
      '__conversionResult',
      'HTML_TO_JSON_RESULT'
    ];
    for (const key of globals) {
      try {
        const value = window[key];
        if (value != null) return value;
      } catch {
        // ignore
      }
    }
    return null;
  }
}

// Export for both module and global usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = MessageHandler;
} else if (typeof window !== 'undefined') {
  window.MessageHandler = MessageHandler;
}
