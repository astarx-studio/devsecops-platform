import {
    useEffect,
    useMemo,
    useState,
    type MouseEvent as ReactMouseEvent,
    type PropsWithChildren
} from "react";
import Collapse from "@mui/material/Collapse";
import List from "@mui/material/List";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemText from "@mui/material/ListItemText";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { useTranslation } from "react-i18next";
import { matchPath, useHref, useLinkClickHandler, useLocation } from "react-router-dom";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import type { AccountEnvironment, Feature } from "..";
import type { TFuncKey } from "../i18n-type";
import fetchContentJson from "../content/fetchContent";
import { usePromise } from "../utils/usePromise";

type RootMenuItem = {
    id?: string;
    label: TFuncKey;
    path: string;
    isVisible?: keyof Feature;
    modulePath?: string;
};

type MenuItemWithChildren = {
    label: TFuncKey;
    children: MenuItem[];
    isVisible?: keyof Feature;
};

export type MenuItem = RootMenuItem | MenuItemWithChildren;

const navItemSx = {
    borderRadius: 2,
    mb: 0.5,
    border: "1px solid #fff",
    "&.Mui-selected": {
        bgcolor: "color-mix(in srgb, var(--platform-surface) 78%, transparent)",
        "&:hover": {
            bgcolor: "color-mix(in srgb, var(--platform-surface) 90%, transparent)"
        }
    }
};

export const PageNav = () => {
    const [menuItems, setMenuItems] = useState<MenuItem[]>();
    const context = useEnvironment<AccountEnvironment>();

    usePromise(signal => fetchContentJson({ signal, context }), setMenuItems);

    return (
        <List component="nav" sx={{ px: 1 }}>
            {menuItems
                ?.filter(menuItem =>
                    menuItem.isVisible
                        ? context.environment.features[menuItem.isVisible]
                        : true
                )
                .map(menuItem => (
                    <NavMenuItem key={menuItem.label as string} menuItem={menuItem} />
                ))}
        </List>
    );
};

function NavMenuItem({ menuItem }: { menuItem: MenuItem }) {
    const { t } = useTranslation();
    const { environment } = useEnvironment<AccountEnvironment>();
    const { pathname } = useLocation();
    const isActive = useMemo(
        () => matchMenuItem(pathname, menuItem, environment.baseUrl),
        [pathname, menuItem, environment.baseUrl]
    );
    const [open, setOpen] = useState(isActive);

    useEffect(() => {
        if (isActive) setOpen(true);
    }, [isActive]);

    if ("path" in menuItem) {
        return (
            <NavLink path={menuItem.path} isActive={isActive}>
                {t(menuItem.label)}
            </NavLink>
        );
    }

    return (
        <>
            <ListItemButton
                data-testid={menuItem.label}
                selected={isActive}
                aria-expanded={open}
                onClick={() => setOpen(current => !current)}
                sx={navItemSx}
            >
                <ListItemText primary={t(menuItem.label)} />
                <ExpandMoreIcon
                    fontSize="small"
                    sx={{
                        transition: "transform 160ms ease",
                        transform: open ? "rotate(180deg)" : "rotate(0deg)"
                    }}
                />
            </ListItemButton>
            <Collapse in={open} unmountOnExit>
                <List disablePadding>
                    {menuItem.children
                        .filter(child =>
                            child.isVisible ? environment.features[child.isVisible] : true
                        )
                        .map(child => (
                            <NavMenuItem key={child.label as string} menuItem={child} />
                        ))}
                </List>
            </Collapse>
        </>
    );
}

function getFullUrl(path: string, baseUrl: string) {
    return `${new URL(baseUrl).pathname}${path}`;
}

function matchMenuItem(
    currentPath: string,
    menuItem: MenuItem,
    baseUrl: string
): boolean {
    if ("path" in menuItem) {
        return !!matchPath(getFullUrl(menuItem.path, baseUrl), currentPath);
    }
    return menuItem.children.some(child => matchMenuItem(currentPath, child, baseUrl));
}

export const NavLink = ({
    path,
    isActive,
    children
}: PropsWithChildren<{ path: string; isActive: boolean }>) => {
    const { environment } = useEnvironment<AccountEnvironment>();
    const menuItemPath = getFullUrl(path, environment.baseUrl) + location.search;
    const href = useHref(menuItemPath);
    const handleClick = useLinkClickHandler(menuItemPath);

    return (
        <ListItemButton
            data-testid={path}
            selected={isActive}
            href={href}
            sx={{ ...navItemSx, pl: path.includes("/") ? 4 : 2 }}
            onClick={event =>
                handleClick(event as unknown as ReactMouseEvent<HTMLAnchorElement>)
            }
        >
            <ListItemText primary={children} />
        </ListItemButton>
    );
};
