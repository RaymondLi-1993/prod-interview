/**
 * Contract shared between apps/api and apps/web.
 *
 * Request and response types live here so that changing an API shape becomes
 * a compile error in the client rather than a runtime surprise. Populated at
 * Level 3, when the first endpoints exist.
 */

export const CONTRACT_VERSION = "v1";
