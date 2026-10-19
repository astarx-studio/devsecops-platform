import md5 from "md5";

export function gravatarUrl(email: string, size: number) {
    const normalized = email.trim().toLowerCase();
    if (!normalized) return null;
    const px = Math.max(32, Math.min(512, Math.round(size)));
    return `https://www.gravatar.com/avatar/${md5(normalized)}?s=${px}&d=404&r=g`;
}

export function pictureValue(value: unknown) {
    const raw = Array.isArray(value) ? value[0] : value;
    if (typeof raw !== "string" || raw.length === 0) return null;
    if (raw.startsWith("data:image/") || raw.startsWith("https://")) return raw;
    return null;
}
