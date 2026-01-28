declare module 'whois-json' {
  interface WhoisResult {
    domainName?: string;
    registrar?: string;
    registrarUrl?: string;
    creationDate?: string;
    expirationDate?: string;
    updatedDate?: string;
    nameServer?: string | string[];
    status?: string | string[];
    [key: string]: unknown;
  }

  function whoisJson(domain: string, options?: { follow?: number; timeout?: number }): Promise<WhoisResult>;
  export = whoisJson;
}
