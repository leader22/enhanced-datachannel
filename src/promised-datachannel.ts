import $debug from "debug";
import BasedDataChannel from "./based-datachannel";

const debug = $debug("promised-dc");
const PAYLOAD_TYPES = {
  REQUEST: 0,
  SUCCESS_RESPONSE: 1,
  ERROR_RESPONSE: 2
};

type JSONValue = boolean | number | string | null | JSONArray | JSONObject;
interface JSONObject {
  [key: string]: JSONValue;
}
// eslint-disable-next-line @typescript-eslint/no-empty-interface
interface JSONArray extends Array<JSONValue> {}

interface SentRequest {
  timer: number;
  resolve: (res: JSONValue) => void;
  reject: (err: Error) => void;
  close: () => void;
}

interface Request {
  type: number;
  id: string;
  data: JSONValue;
}
interface SuccessResponse {
  type: number;
  id: string;
  data: JSONValue;
}
interface ErrorResponse {
  type: number;
  id: string;
  err: string;
}

type SendPayload = Request | SuccessResponse | ErrorResponse;

class PromisedDataChannel extends BasedDataChannel {
  private _sentRequests: Map<string, SentRequest>;

  constructor(dc: RTCDataChannel) {
    super(dc);

    this._sentRequests = new Map();
  }

  close() {
    debug("close()");

    for (const sentRequest of this._sentRequests.values()) {
      sentRequest.close();
    }
    this._sentRequests.clear();

    super.close();
  }

  async send(data: JSONValue): Promise<JSONValue> {
    debug("send()", data);

    if (this._closed) {
      throw new Error("Closed!");
    }
    if (this._dc.readyState !== "open") {
      throw new Error("Not opened!");
    }

    const id = String(Math.random()).slice(2, 6);
    const request = {
      type: PAYLOAD_TYPES.REQUEST,
      id,
      data
    };

    this._sendMessage(request);

    return new Promise((resolve, reject) => {
      const timeout = 1000 + 500 * this._sentRequests.size;

      const sentRequest = {
        timer: window.setTimeout(() => {
          if (!this._sentRequests.delete(request.id)) return;

          reject(new Error("Timeout!"));
        }, timeout),
        resolve: (res: JSONValue) => {
          if (!this._sentRequests.delete(request.id)) return;

          window.clearTimeout(sentRequest.timer);
          resolve(res);
        },
        reject: (err: Error) => {
          if (!this._sentRequests.delete(request.id)) return;

          window.clearTimeout(sentRequest.timer);
          reject(err);
        },
        close: () => {
          if (!this._sentRequests.delete(request.id)) return;

          window.clearTimeout(sentRequest.timer);
          reject(new Error("Closed!"));
        }
      };

      this._sentRequests.set(id, sentRequest);
    });
  }

  private _sendMessage(data: SendPayload) {
    this._dc.send(JSON.stringify(data));
  }

  protected _handleMessage(ev: MessageEvent) {
    const evData: SendPayload = JSON.parse(ev.data);
    switch (evData.type) {
      case PAYLOAD_TYPES.REQUEST:
        return this._handleRequest(evData as Request);
      case PAYLOAD_TYPES.SUCCESS_RESPONSE:
      case PAYLOAD_TYPES.ERROR_RESPONSE:
        return this._handleResponse(evData as SuccessResponse | ErrorResponse);
    }
  }

  // on("message", (data, resolve, reject) => {})
  private _handleRequest(request: Request) {
    try {
      this.emit(
        "message",
        request.data,
        (data: JSONValue) => {
          this._sendMessage({
            type: PAYLOAD_TYPES.SUCCESS_RESPONSE,
            id: request.id,
            data
          });
        },
        (err: Error) => {
          this._sendMessage({
            type: PAYLOAD_TYPES.ERROR_RESPONSE,
            id: request.id,
            err: err.toString()
          });
        }
      );
    } catch (err) {
      this._sendMessage({
        type: PAYLOAD_TYPES.ERROR_RESPONSE,
        id: request.id,
        err: err.toString()
      });
    }
  }

  private _handleResponse(response: SuccessResponse | ErrorResponse) {
    const sentRequest = this._sentRequests.get(response.id);

    if (!sentRequest) {
      debug("sent request not found...");
      return;
    }

    if ("err" in response) {
      return sentRequest.reject(new Error(response.err));
    }

    return sentRequest.resolve(response.data);
  }
}

export default PromisedDataChannel;
