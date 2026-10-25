export interface ContainerAppResourceIdentity {
  readonly resourceId: string;
  readonly userId: string;
  readonly appName: string;
}

export function userWorkloadResourceGroup(userId: string, platformResourceGroup: string): string | null {
  if (!/^[0-9]{1,32}$/.test(userId)) return null;
  const group: string = `user-rg-${userId}`;
  return group.toLowerCase() === platformResourceGroup.toLowerCase() ? null : group;
}

export function ownedContainerAppResource(
  input: ContainerAppResourceIdentity, subscriptionId: string, platformResourceGroup: string,
): { resourceGroup: string; resourceId: string } | null {
  const group: string | null = userWorkloadResourceGroup(input.userId, platformResourceGroup);
  if (!group || !/^[a-z][a-z0-9-]{0,30}[a-z0-9]$/.test(input.appName)) return null;
  const expected: string = `/subscriptions/${subscriptionId}/resourceGroups/${group}/providers/Microsoft.App/containerApps/${input.appName}`;
  return input.resourceId.toLowerCase() === expected.toLowerCase() ? { resourceGroup: group, resourceId: expected } : null;
}
