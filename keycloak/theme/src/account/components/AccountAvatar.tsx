import { useState } from "react";
import Box from "@mui/material/Box";
import { gravatarUrl } from "../utils/gravatar";

function initials(name: string) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    const letters = (parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0]?.slice(0, 2)) || "?";
    return letters.toUpperCase();
}

export function AccountAvatar({
    name,
    email,
    picture,
    size = 40
}: {
    name: string;
    email?: string;
    picture?: string | null;
    size?: number;
}) {
    const identity = `${picture ?? ""}|${email ?? ""}`;
    const [seen, setSeen] = useState(identity);
    const [gravatarFailed, setGravatarFailed] = useState(false);
    if (seen !== identity) {
        setSeen(identity);
        setGravatarFailed(false);
    }

    const gravatar = !picture && email && !gravatarFailed ? gravatarUrl(email, size * 2) : null;
    const src = picture || gravatar;

    return (
        <Box
            component="span"
            sx={{
                width: size,
                height: size,
                borderRadius: "50%",
                overflow: "hidden",
                display: "inline-flex",
                flexShrink: 0,
                alignItems: "center",
                justifyContent: "center",
                bgcolor: "primary.main",
                color: "primary.contrastText",
                fontWeight: 700,
                fontSize: Math.max(12, Math.round(size * 0.36)),
                lineHeight: 1
            }}
        >
            {src ? (
                <Box
                    component="img"
                    alt=""
                    src={src}
                    referrerPolicy="no-referrer"
                    onError={() => {
                        if (!picture) setGravatarFailed(true);
                    }}
                    sx={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                />
            ) : (
                initials(name)
            )}
        </Box>
    );
}
