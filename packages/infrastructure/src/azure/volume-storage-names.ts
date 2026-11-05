export function userStorageAccountName(userId: string): string {
  const sanitized: string = userId.toLowerCase().replace(/[^a-z0-9]/g, "");
  return `stkumo${sanitized.slice(0, 18).padEnd(3, "0")}`;
}

export function volumeShareName(volumeName: string): string {
  return `share-vol-${volumeName.slice(0, 50)}`;
}

export function legacyVolumeShareName(appName: string, volumeName: string): string {
  return `share-${appName.slice(0, 25)}-${volumeName.slice(0, 25)}`;
}

export function storageLinkName(appName: string, volumeName: string): string {
  return `stg-${appName.slice(0, 13)}-${volumeName.slice(0, 13)}`;
}
