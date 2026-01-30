export default {
    async fetch(request, env) {
        const url = new URL(request.url);
        if (url.pathname === "/health") {
            return new Response("ok", { status: 200 });
        }
        return new Response("vidcom api v4", { status: 200 });
    }
};
