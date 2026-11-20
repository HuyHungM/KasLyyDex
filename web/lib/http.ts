import { lookup as systemLookup } from "node:dns";
import { Resolver } from "node:dns";
import { Agent, fetch as undiciFetch } from "undici";

// Some local DNS filters sinkhole mangadex hosts to 127.0.0.1;
// resolve through public DNS instead, falling back to system DNS.
const resolver = new Resolver();
resolver.setServers(["1.1.1.1", "8.8.8.8"]);

export const agent = new Agent({
  connect: {
    lookup(hostname, options, callback) {
      resolver.resolve4(hostname, (err, addresses) => {
        if (err || addresses.length === 0) return systemLookup(hostname, options, callback);
        if (options.all) {
          return callback(null, addresses.map((address) => ({ address, family: 4 })));
        }
        callback(null, addresses[0], 4);
      });
    },
  },
});

export { undiciFetch };