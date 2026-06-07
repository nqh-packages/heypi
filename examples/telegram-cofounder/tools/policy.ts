export type ActorAccess = {
	trusted: boolean;
	localDev: boolean;
	confirmed?: boolean;
};

export type PolicyDecision = {
	allowed: boolean;
	reason: string;
};

export function mutatingAllowed(access: ActorAccess): PolicyDecision {
	if (access.trusted || access.localDev)
		return { allowed: true, reason: "trusted operator or local development flag is configured" };
	return {
		allowed: false,
		reason: "mutating tools require a trusted Telegram user allowlist or HEYPI_LOCAL_DEV_MUTATIONS=true",
	};
}

export function confirmedMutationAllowed(access: ActorAccess): PolicyDecision {
	const base = mutatingAllowed(access);
	if (!base.allowed) return base;
	if (!access.confirmed) return { allowed: false, reason: "explicit trusted confirmation is required for this route" };
	return { allowed: true, reason: "trusted confirmation received" };
}

export function refusesSecrets(text: string): PolicyDecision {
	if (/token|password|private key|cookie|secret/i.test(text)) {
		return { allowed: false, reason: "secret, cookie, token, password, and private-key capture is excluded" };
	}
	return { allowed: true, reason: "no secret capture requested" };
}
