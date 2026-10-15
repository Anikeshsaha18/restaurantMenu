const express = require("express");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(express.json());

const FIELDS = [
    "dishname",
    "restaurant",
    "category",
    "price",
    "calories",
    "isvegetarian"
];

const ALLOWED_QUERY = [
    "page",
    "limit",
    "search",
    "isvegetarian",
    "minPrice",
    "maxPrice",
    "sort",
    "order"
];

let restaurantMenu = [];
let nextId = 1;

function sendError(res, status, message) {
    return res.status(status).json({ error: message });
}

function findRestaurantMenuItem(id) {
    return restaurantMenu.find(item => String(item.id) === id);
}

function clean(body) {
    const result = {};

    for (const key of FIELDS) {
        if (Object.prototype.hasOwnProperty.call(body, key)) {
            result[key] =
                typeof body[key] === "string"
                    ? body[key].trim()
                    : body[key];
        }
    }

    return result;
}

function validate(body, currentId = null, partial = false) {
    if (
        !body ||
        typeof body !== "object" ||
        Array.isArray(body)
    ) {
        return "Request body must be a JSON object";
    }

    if (!partial) {
        for (const field of FIELDS) {
            if (!Object.prototype.hasOwnProperty.call(body, field)) {
                return `Missing required field: ${field}`;
            }
        }
    }

    const supplied = FIELDS.filter(field =>
        Object.prototype.hasOwnProperty.call(body, field)
    );

    if (partial && supplied.length === 0) {
        return "PATCH must contain at least one recognised field";
    }

    const data = clean(body);

    for (const field of supplied) {
        const value = data[field];

        if (["dishname", "restaurant", "category"].includes(field)) {
            if (typeof value !== "string") {
                return `${field} must be a string`;
            }

            const limits = {
                dishname: [3, 60],
                restaurant: [2, 40],
                category: [4, 20]
            };

            const [min, max] = limits[field];

            if (value.length < min || value.length > max) {
                return `${field} must be ${min} to ${max} characters`;
            }
        }

        if (
            field === "price" &&
            (
                typeof value !== "number" ||
                !Number.isFinite(value) ||
                value < 0
            )
        ) {
            return "price must be a non-negative number";
        }

        if (
            field === "calories" &&
            (
                !Number.isInteger(value) ||
                value < 0
            )
        ) {
            return "calories must be a non-negative integer";
        }

        if (
            field === "isvegetarian" &&
            typeof value !== "boolean"
        ) {
            return "isvegetarian must be a JSON boolean";
        }
    }

    const dishname = data.dishname;
    const restaurant = data.restaurant;

    if (
        supplied.includes("dishname") &&
        supplied.includes("restaurant")
    ) {
        const duplicate = restaurantMenu.some(item =>
            item.dishname.toLowerCase() === dishname.toLowerCase() &&
            item.restaurant.toLowerCase() === restaurant.toLowerCase() &&
            String(item.id) !== String(currentId)
        );

        if (duplicate) {
            return "This dish already exists for that restaurant";
        }
    }

    return null;
}

// CREATE
app.post("/api/restaurantMenu", (req, res) => {
    const problem = validate(req.body);

    if (problem) {
        return sendError(res, 400, problem);
    }

    const item = {
        id: nextId++,
        ...clean(req.body)
    };

    restaurantMenu.push(item);
    return res.status(201).json(item);
});

// LIST, FILTER, SEARCH, SORT, PAGINATION
app.get("/api/restaurantMenu", (req, res) => {
    const q = req.query;

    for (const key of Object.keys(q)) {
        if (!ALLOWED_QUERY.includes(key) || Array.isArray(q[key])) {
            return sendError(
                res,
                400,
                `Invalid query parameter: ${key}`
            );
        }
    }

    function integer(value, fallback, maximum = Infinity) {
        if (value === undefined) return fallback;
        if (!/^\d+$/.test(value)) return null;

        const n = Number(value);

        return Number.isSafeInteger(n) &&
            n >= 1 &&
            n <= maximum
            ? n
            : null;
    }

    const page = integer(q.page, 1);
    const limit = integer(q.limit, 10, 50);

    if (page === null) {
        return sendError(res, 400, "Invalid page");
    }

    if (limit === null) {
        return sendError(res, 400, "Invalid limit");
    }

    if (
        q.isvegetarian !== undefined &&
        !["true", "false"].includes(q.isvegetarian)
    ) {
        return sendError(
            res,
            400,
            "isvegetarian must be true or false"
        );
    }

    function parsePrice(value) {
        if (value === undefined) return undefined;

        if (
            value.trim() === "" ||
            !Number.isFinite(Number(value))
        ) {
            return null;
        }

        return Number(value);
    }

    const minPrice = parsePrice(q.minPrice);
    const maxPrice = parsePrice(q.maxPrice);

    if (minPrice === null || maxPrice === null) {
        return sendError(res, 400, "Price range must contain numbers");
    }

    if (
        minPrice !== undefined &&
        maxPrice !== undefined &&
        minPrice > maxPrice
    ) {
        return res.status(200).json({
            data: [],
            page,
            limit,
            total: 0,
            totalPages: 0
        });
    }

    if (
        q.sort !== undefined &&
        !["dishname", "restaurant", "category", "price", "calories"].includes(q.sort)
    ) {
        return sendError(res, 400, "Invalid sort field");
    }

    if (
        q.order !== undefined &&
        !["asc", "desc"].includes(q.order)
    ) {
        return sendError(res, 400, "Invalid sort order");
    }

    let result = [...restaurantMenu];

    if (q.isvegetarian !== undefined) {
        result = result.filter(
            item => item.isvegetarian === (q.isvegetarian === "true")
        );
    }

    if (minPrice !== undefined) {
        result = result.filter(item => item.price >= minPrice);
    }

    if (maxPrice !== undefined) {
        result = result.filter(item => item.price <= maxPrice);
    }

    if (q.search) {
        const search = q.search.toLowerCase();

        result = result.filter(item =>
            item.dishname.toLowerCase().includes(search) ||
            item.restaurant.toLowerCase().includes(search) ||
            item.category.toLowerCase().includes(search)
        );
    }

    if (q.sort) {
        const field = q.sort;
        const direction = q.order === "desc" ? -1 : 1;

        result.sort((a, b) => {
            const x = typeof a[field] === "string"
                ? a[field].toLowerCase()
                : a[field];

            const y = typeof b[field] === "string"
                ? b[field].toLowerCase()
                : b[field];

            if (x < y) return -direction;
            if (x > y) return direction;
            return 0;
        });
    } else {
        result.sort((a, b) => a.id - b.id);
    }

    const total = result.length;
    const totalPages = total === 0 ? 0 : Math.ceil(total / limit);
    const data = result.slice((page - 1) * limit, page * limit);

    return res.status(200).json({
        data,
        page,
        limit,
        total,
        totalPages
    });
});

// READ ONE
app.get("/api/restaurantMenu/:id", (req, res) => {
    const item = findRestaurantMenuItem(req.params.id);

    if (!item) {
        return sendError(res, 404, "Record not found");
    }

    return res.status(200).json(item);
});

// REPLACE
app.put("/api/restaurantMenu/:id", (req, res) => {
    const item = findRestaurantMenuItem(req.params.id);

    if (!item) {
        return sendError(res, 404, "Record not found");
    }

    const problem = validate(req.body, item.id);

    if (problem) {
        return sendError(res, 400, problem);
    }

    const updated = {
        id: item.id,
        ...clean(req.body)
    };

    restaurantMenu = restaurantMenu.map(existing =>
        existing.id === item.id ? updated : existing
    );

    return res.status(200).json(updated);
});

// PARTIAL UPDATE
app.patch("/api/restaurantMenu/:id", (req, res) => {
    const item = findRestaurantMenuItem(req.params.id);

    if (!item) {
        return sendError(res, 404, "Record not found");
    }

    const problem = validate(req.body, item.id, true);

    if (problem) {
        return sendError(res, 400, problem);
    }

    const updated = {
        ...item,
        ...clean(req.body),
        id: item.id
    };

    const fullProblem = validate(updated, item.id);

    if (fullProblem) {
        return sendError(res, 400, fullProblem);
    }

    restaurantMenu = restaurantMenu.map(existing =>
        existing.id === item.id ? updated : existing
    );

    return res.status(200).json(updated);
});

// DELETE
app.delete("/api/restaurantMenu/:id", (req, res) => {
    const item = findRestaurantMenuItem(req.params.id);

    if (!item) {
        return sendError(res, 404, "Record not found");
    }

    restaurantMenu = restaurantMenu.filter(
        existing => existing.id !== item.id
    );

    return res.status(204).end();
});

// Unknown routes
app.use((req, res) => {
    return sendError(res, 404, "Route not found");
});

// JSON parsing and other errors
app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);

    if (
        err instanceof SyntaxError &&
        err.status === 400 &&
        "body" in err
    ) {
        return sendError(res, 400, "Malformed JSON");
    }

    return sendError(res, 400, "Invalid request");
});

app.listen(PORT, "0.0.0.0", () => {
    console.log(`Restaurant Menu API running on port ${PORT}`);
});
