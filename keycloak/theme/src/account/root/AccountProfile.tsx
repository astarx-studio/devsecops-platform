import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useEnvironment } from "../../shared/keycloak-ui-shared";
import type { AccountEnvironment } from "..";
import { getPersonalInfo } from "../api/methods";
import { pictureValue } from "../utils/gravatar";

type AccountProfileState = {
    email: string;
    name: string;
    picture: string | null;
    refresh: () => Promise<void>;
};

const AccountProfileContext = createContext<AccountProfileState | null>(null);

export function AccountProfileProvider({ children }: { children: ReactNode }) {
    const context = useEnvironment<AccountEnvironment>();
    const contextRef = useRef(context);
    contextRef.current = context;
    const token = context.keycloak.tokenParsed;
    const [state, setState] = useState(() => ({
        email: typeof token?.email === "string" ? token.email : "",
        name:
            typeof token?.name === "string"
                ? token.name
                : typeof token?.preferred_username === "string"
                  ? token.preferred_username
                  : "",
        picture: null as string | null
    }));

    const refresh = useCallback(async () => {
        const info = await getPersonalInfo({ context: contextRef.current });
        const name = [info.firstName, info.lastName].filter(Boolean).join(" ") || info.username || "";
        setState({
            email: typeof info.email === "string" ? info.email : "",
            name,
            picture: pictureValue(info.attributes?.picture)
        });
    }, []);

    useEffect(() => {
        void refresh().catch(() => undefined);
    }, [refresh]);

    const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
    return <AccountProfileContext.Provider value={value}>{children}</AccountProfileContext.Provider>;
}

export function useAccountProfile() {
    const value = useContext(AccountProfileContext);
    if (!value) {
        throw new Error("Account profile is unavailable");
    }
    return value;
}
