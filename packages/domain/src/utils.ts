const ALPHANUMERIC_REGEX: RegExp = /^[a-zA-Z0-9]+$/;
const BLANK_REGEX: RegExp = /^\s*$/;
const EMAIL_REGEX: RegExp = /[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?/g;

export function isAlphaNumStr(s: string): boolean { 
  return ALPHANUMERIC_REGEX.test(s);
}

export function isBlankStr(s: string): boolean { 
  return BLANK_REGEX.test(s);
}

export function isValidEmail(s: string): boolean {
  return EMAIL_REGEX.test(s);
}