/**
 * `scripts/generate-tokens.mjs` için elle yazılmış tip bildirimi.
 * Betik düz Node tarafından çalıştırıldığından TS değildir; testlerin
 * tip güvenliğini bu bildirim sağlar.
 */

/** CSS özel değişkenlerini Prettier-uyumlu TS token sabitine dönüştürür. */
export declare function generateTokensTs(css: string): Promise<string>;
