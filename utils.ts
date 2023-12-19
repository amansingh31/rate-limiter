export const getTracker = (req) => {
    const possibleHeaders = ['x-forwarded-for', 'x-real-ip', 'x-client-ip', 'cf-connecting-ip'];
    for (const header of possibleHeaders) {
        const ip = req.headers[header];
        if (ip) {
            // In case the header contains multiple IPs, return the first one
            return typeof ip === 'string' ? ip.split(',')[0].trim() : ip[0].trim();
        }
    }

    // Fallback to the direct IP from the request
    return req.connection.remoteAddress || req.socket.remoteAddress || null;
}
