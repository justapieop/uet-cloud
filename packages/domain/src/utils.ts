const ALPHANUMERIC_REGEX: RegExp = /^[a-zA-Z0-9]+$/;
const BLANK_REGEX: RegExp = /^\s*$/;

export function isAlphaNumStr(s: string): boolean { 
  return ALPHANUMERIC_REGEX.test(s);
}

export function isBlankStr(s: string): boolean { 
  return BLANK_REGEX.test(s);
}
