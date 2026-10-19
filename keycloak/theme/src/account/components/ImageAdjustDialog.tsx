import { useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Slider from "@mui/material/Slider";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import FlipRounded from "@mui/icons-material/FlipRounded";
import RotateLeftRounded from "@mui/icons-material/RotateLeftRounded";
import RotateRightRounded from "@mui/icons-material/RotateRightRounded";
import Cropper, { type Area, type Point } from "react-easy-crop";
import "react-easy-crop/react-easy-crop.css";
import { useTranslation } from "react-i18next";
import { fitZoom, flipImageFile, renderSquareDataUrl, squareCropPixels, zoomFromWheel } from "./imageCrop";

type MediaBox = { width: number; height: number; naturalWidth: number; naturalHeight: number };

function wrapDegrees(value: number) {
    return ((value + 180) % 360 + 360) % 360 - 180;
}

export function ImageAdjustDialog({
    file,
    open,
    onClose,
    onConfirm
}: {
    file: File | null;
    open: boolean;
    onClose: () => void;
    onConfirm: (dataUrl: string) => void | Promise<void>;
}) {
    const { t } = useTranslation();
    const frameRef = useRef<HTMLDivElement>(null);
    const minZoomRef = useRef(1);
    const busyRef = useRef(false);
    const session = useRef(0);
    const [url, setUrl] = useState<string | null>(null);
    const [source, setSource] = useState<File | null>(null);
    const [side, setSide] = useState(0);
    const [media, setMedia] = useState<MediaBox | null>(null);
    const [crop, setCrop] = useState<Point>({ x: 0, y: 0 });
    const [zoom, setZoom] = useState(1);
    const [minZoom, setMinZoom] = useState(1);
    const [rotation, setRotation] = useState(0);
    const [pixels, setPixels] = useState<Area | null>(null);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    busyRef.current = busy;

    useEffect(() => {
        session.current += 1;
        setBusy(false);
        if (!open || !file) return;
        const next = URL.createObjectURL(file);
        setUrl(next);
        setSource(file);
        setCrop({ x: 0, y: 0 });
        setZoom(1);
        setMinZoom(1);
        minZoomRef.current = 1;
        setRotation(0);
        setMedia(null);
        setPixels(null);
        setError("");
        return () => URL.revokeObjectURL(next);
    }, [open, file]);

    useEffect(() => {
        const el = frameRef.current;
        if (!open || !el) return;
        const onWheel = (event: WheelEvent) => {
            if (busyRef.current) return;
            event.preventDefault();
            event.stopPropagation();
            setZoom(current => zoomFromWheel(current, event.deltaY, event.deltaMode, minZoomRef.current, 4, el.clientHeight));
        };
        el.addEventListener("wheel", onWheel, { passive: false });
        return () => el.removeEventListener("wheel", onWheel);
    }, [open, url]);

    useEffect(() => {
        const el = frameRef.current;
        if (!open || !el) return;
        const apply = () => setSide(Math.round(el.clientWidth));
        apply();
        const observer = new ResizeObserver(apply);
        observer.observe(el);
        return () => observer.disconnect();
    }, [open, url]);

    useEffect(() => {
        if (!media || side <= 0 || media.width <= 0 || media.height <= 0) return;
        const nextMin = fitZoom(media.width, media.height, side, rotation);
        setZoom(current => (Math.abs(current - minZoomRef.current) < 0.03 ? nextMin : Math.max(current, nextMin)));
        minZoomRef.current = nextMin;
        setMinZoom(nextMin);
    }, [media, side, rotation]);

    useEffect(() => {
        if (!media || side <= 0 || media.width <= 0 || media.height <= 0) return;
        setPixels(
            squareCropPixels({
                crop,
                zoom,
                rotation,
                mediaWidth: media.width,
                mediaHeight: media.height,
                naturalWidth: media.naturalWidth,
                naturalHeight: media.naturalHeight,
                cropSize: side
            })
        );
    }, [crop, zoom, rotation, media, side]);

    async function mirror(axis: "horizontal" | "vertical") {
        if (!source || busy) return;
        const id = session.current;
        setBusy(true);
        setError("");
        try {
            const flipped = await flipImageFile(source, axis);
            if (id !== session.current) return;
            const next = URL.createObjectURL(flipped);
            setUrl(prev => {
                if (prev) URL.revokeObjectURL(prev);
                return next;
            });
            setSource(flipped);
            setMedia(null);
        } catch {
            if (id === session.current) setError(t("profilePhotoReadError", { defaultValue: "Could not read that image. Try a different photo." }));
        } finally {
            if (id === session.current) setBusy(false);
        }
    }

    async function confirm() {
        if (!url || !pixels || busy) return;
        const id = session.current;
        setBusy(true);
        setError("");
        try {
            const dataUrl = await renderSquareDataUrl(url, pixels, rotation);
            if (id !== session.current) return;
            await onConfirm(dataUrl);
        } catch {
            if (id === session.current) setError(t("profilePhotoReadError", { defaultValue: "Could not read that image. Try a different photo." }));
        } finally {
            if (id === session.current) setBusy(false);
        }
    }

    const rotateLeft = t("profilePhotoRotateLeft", { defaultValue: "Rotate left" });
    const rotateRight = t("profilePhotoRotateRight", { defaultValue: "Rotate right" });
    const flipHorizontal = t("profilePhotoFlipHorizontal", { defaultValue: "Flip horizontally" });
    const flipVertical = t("profilePhotoFlipVertical", { defaultValue: "Flip vertically" });
    const zoomLabel = t("profilePhotoZoom", { defaultValue: "Zoom" });
    const rotationLabel = t("profilePhotoRotation", { defaultValue: "Rotation" });

    return (
        <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
            <DialogTitle>{t("profilePhotoAdjust", { defaultValue: "Adjust your photo" })}</DialogTitle>
            <DialogContent>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
                    {t("profilePhotoAdjustHelp", { defaultValue: "Drag to frame your photo. Scroll or use the slider to zoom." })}
                </Typography>
                <Box
                    ref={frameRef}
                    sx={{
                        position: "relative",
                        width: "100%",
                        maxWidth: 360,
                        mx: "auto",
                        aspectRatio: "1",
                        bgcolor: "action.hover",
                        borderRadius: 1,
                        overflow: "hidden"
                    }}
                >
                    {url && side > 0 ? (
                        <Cropper
                            image={url}
                            crop={crop}
                            zoom={zoom}
                            rotation={rotation}
                            aspect={1}
                            cropSize={{ width: side, height: side }}
                            objectFit="contain"
                            minZoom={minZoom}
                            maxZoom={4}
                            zoomWithScroll={false}
                            showGrid
                            onCropChange={setCrop}
                            onZoomChange={setZoom}
                            onRotationChange={setRotation}
                            onMediaLoaded={loaded =>
                                setMedia({
                                    width: loaded.width,
                                    height: loaded.height,
                                    naturalWidth: loaded.naturalWidth,
                                    naturalHeight: loaded.naturalHeight
                                })
                            }
                        />
                    ) : null}
                </Box>
                <Box sx={{ display: "flex", justifyContent: "center", gap: 0.5, mt: 1.5 }}>
                    <Tooltip title={rotateLeft}>
                        <IconButton aria-label={rotateLeft} onClick={() => setRotation(value => wrapDegrees(value - 90))} disabled={busy}>
                            <RotateLeftRounded />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={rotateRight}>
                        <IconButton aria-label={rotateRight} onClick={() => setRotation(value => wrapDegrees(value + 90))} disabled={busy}>
                            <RotateRightRounded />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={flipHorizontal}>
                        <IconButton aria-label={flipHorizontal} onClick={() => void mirror("horizontal")} disabled={busy}>
                            <FlipRounded />
                        </IconButton>
                    </Tooltip>
                    <Tooltip title={flipVertical}>
                        <IconButton aria-label={flipVertical} onClick={() => void mirror("vertical")} disabled={busy}>
                            <FlipRounded sx={{ transform: "rotate(90deg)" }} />
                        </IconButton>
                    </Tooltip>
                </Box>
                <Typography variant="caption" component="label" htmlFor="profile-photo-zoom" sx={{ display: "block", mt: 1 }}>
                    {zoomLabel}
                </Typography>
                <Slider
                    id="profile-photo-zoom"
                    size="small"
                    aria-label={zoomLabel}
                    value={zoom}
                    min={minZoom}
                    max={4}
                    step={0.01}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${Math.round(value * 100)}%`}
                    onChange={(_event, value) => setZoom(value as number)}
                    disabled={busy}
                />
                <Typography variant="caption" component="label" htmlFor="profile-photo-rotation" sx={{ display: "block" }}>
                    {rotationLabel}
                </Typography>
                <Slider
                    id="profile-photo-rotation"
                    size="small"
                    aria-label={rotationLabel}
                    value={rotation}
                    min={-180}
                    max={180}
                    step={1}
                    valueLabelDisplay="auto"
                    valueLabelFormat={value => `${value}°`}
                    onChange={(_event, value) => setRotation(value as number)}
                    disabled={busy}
                />
                {error ? (
                    <Typography color="error" variant="body2">
                        {error}
                    </Typography>
                ) : null}
            </DialogContent>
            <DialogActions>
                <Button onClick={onClose} disabled={busy}>
                    {t("cancel")}
                </Button>
                <Button variant="contained" onClick={() => void confirm()} disabled={busy || !pixels}>
                    {t("profilePhotoUse", { defaultValue: "Use this photo" })}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
