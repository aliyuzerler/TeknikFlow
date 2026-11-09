import { describe, expect, it } from 'vitest';
import { branchScopeAllows, parseBranchScope } from './auth-context.js';

describe('şube kapsamı denetimi (rol denetiminden AYRI)', () => {
  it('"ALL" her şubeye izin verir', () => {
    expect(branchScopeAllows('ALL', 'branch-1')).toBe(true);
  });

  it('liste yalnız üye şubelere izin verir', () => {
    const scope = ['b1', 'b2'];
    expect(branchScopeAllows(scope, 'b1')).toBe(true);
    expect(branchScopeAllows(scope, 'b3')).toBe(false);
  });

  it('tanımsız kapsam hiçbir şubeye izin vermez (fail-closed)', () => {
    expect(branchScopeAllows(undefined, 'b1')).toBe(false);
  });

  it('boş liste hiçbir şubeye izin vermez', () => {
    expect(branchScopeAllows([], 'b1')).toBe(false);
  });

  it('parseBranchScope bozuk veriyi reddederek kapsamsız döner', () => {
    expect(parseBranchScope('ALL')).toBe('ALL');
    expect(parseBranchScope(['b1'])).toEqual(['b1']);
    expect(parseBranchScope(42)).toBeUndefined();
    expect(parseBranchScope([1, 2])).toBeUndefined();
    expect(parseBranchScope(null)).toBeUndefined();
    expect(parseBranchScope({})).toBeUndefined();
  });
});
