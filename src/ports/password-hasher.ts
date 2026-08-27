export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
  /**
   * Whether a stored hash was produced with weaker parameters than this hasher
   * currently uses. Optional so an implementation may decline to support
   * upgrade-on-login; callers must treat an absent method as "no rehash needed".
   */
  needsRehash?(encodedHash: string): boolean;
}
