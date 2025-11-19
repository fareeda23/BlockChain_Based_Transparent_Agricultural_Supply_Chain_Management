const express = require("express");
const router = express.Router();
const contract = require("../blockchain"); // ✅ Blockchain contract
const runPythonCheck = require("../utils/runPythonCheck");

// 🧑‍🌾 Add Product (Farmer) - Stores all details on blockchain
router.post("/farmer/add-product", async (req, res) => {
    const { name, basePrice, state, district, market } = req.body;

    if (!name || basePrice === undefined || !state || !district || !market) {
        return res.status(400).json({ error: "Missing required fields: name, basePrice, state, district, market" });
    }

    try {
        // Sanitize and validate inputs
        const trimmedName = String(name).trim();
        const trimmedState = String(state).trim();
        const trimmedDistrict = String(district).trim();
        const trimmedMarket = String(market).trim();

        const priceNum = Number(basePrice);
        if (!Number.isFinite(priceNum) || priceNum < 0) {
            return res.status(400).json({ error: "basePrice must be a non-negative number" });
        }

        // Call contract
        const tx = await contract.addProduct(trimmedName, priceNum, trimmedState, trimmedDistrict, trimmedMarket);
        const receipt = await tx.wait();

        // 🔁 Get current productCount (latest ID)
        const productCount = await contract.productCount();

        res.status(200).json({
            message: "✅ Product added to blockchain.",
            productId: productCount.toString(),
            txHash: receipt.hash
        });
    } catch (error) {
        console.error("❌ Error adding product to blockchain:", error);
        
        // Provide helpful error messages
        let errorMessage = error.message;
        if (error.message && /negative|out-of-range|overflow|underflow/i.test(error.message)) {
            errorMessage = "Invalid basePrice: must be >= 0";
        }
        
        if (error.message.includes("no matching fragment") || error.message.includes("UNSUPPORTED_OPERATION")) {
            errorMessage = "Contract ABI mismatch! The deployed contract doesn't match the compiled code. Please redeploy: cd blockchain && npx hardhat run scripts/deploy.js --network localhost";
        } else if (error.message.includes("network") || error.message.includes("connection")) {
            errorMessage = "Cannot connect to blockchain. Please ensure Hardhat node is running on http://127.0.0.1:8545";
        } else if (error.message.includes("insufficient funds")) {
            errorMessage = "Insufficient funds in wallet for transaction";
        } else if (error.message.includes("not connected")) {
            errorMessage = "Blockchain not connected. Please check your .env file and ensure contract is deployed.";
        }
        
        res.status(500).json({ error: errorMessage });
    }
});




// 🧑‍💼 Update Price (Vendor) - now guarded by ML fraud detection
router.post("/vendor/update-price", async (req, res) => {
    const { productId, newPrice } = req.body;

    const numericProductId = Number(productId);
    const numericPrice = Number(newPrice);

    if (!Number.isInteger(numericProductId) || numericProductId <= 0) {
        return res.status(400).json({ error: "Valid productId is required" });
    }
    if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
        return res.status(400).json({ error: "newPrice must be a positive number" });
    }

    let product;
    try {
        product = await contract.getProduct(numericProductId);
    } catch (error) {
        console.error("❌ Unable to fetch product for ML validation:", error);
        return res.status(400).json({ error: "Invalid productId or blockchain unavailable" });
    }

    const [commodity,, state, district, market] = product;

    let mlResult;
    try {
        mlResult = await runPythonCheck({
            commodity,
            state,
            district,
            market,
            vendor_price: numericPrice
        });
    } catch (error) {
        console.error("❌ Python ML check failed:", error);
        return res.status(502).json({ error: error.message || "Failed to run ML price verification" });
    }

    if (mlResult.status === "error") {
        return res.status(502).json({ error: mlResult.message || "Price verification failed", mlResult });
    }

    if (mlResult.status !== "accept") {
        return res.status(400).json({
            error: mlResult.reason || "Vendor price rejected by ML",
            mlResult
        });
    }

    try {
        const tx = await contract.updatePrice(numericProductId, numericPrice);
        const receipt = await tx.wait();

        res.status(200).json({
            message: "✅ Price updated on blockchain.",
            txHash: receipt.hash,
            mlResult,
            mlVerificationStatus: mlResult.status,
            mlReason: mlResult.reason || "",
            marketModalPrice: mlResult.market_modal_price ?? mlResult.marketModalPrice ?? null
        });
    } catch (error) {
        console.error("❌ Error updating price:", error);
        res.status(500).json({ error: error.message });
    }
});



// 📦 Get Product by ID (for history or display) - Fetches from blockchain
router.get("/product/:id", async (req, res) => {
    const { id } = req.params;

    try {
        const product = await contract.getProduct(id);

        const formatted = {
            name: product[0],
            basePrice: product[1].toString(),
            state: product[2],
            district: product[3],
            market: product[4],
            farmer: product[5],
            priceTrail: product[6].map(p => p.toString()),
            handlers: product[7],
            blockchainProductId: id
        };

        res.status(200).json(formatted);
    } catch (error) {
        console.error("❌ Error fetching product:", error);
        
        let errorMessage = error.message;
        if (error.message.includes("network") || error.message.includes("connection")) {
            errorMessage = "Cannot connect to blockchain. Please ensure Hardhat node is running.";
        } else if (error.message.includes("not connected")) {
            errorMessage = "Blockchain not connected. Please check configuration.";
        }
        
        res.status(500).json({ error: errorMessage });
    }
});

// 📋 Get all products from blockchain (for vendor dropdowns)
router.get("/products/all", async (req, res) => {
    try {
        const productCount = await contract.productCount();
        const products = [];

        for (let i = 1; i <= productCount; i++) {
            try {
                const product = await contract.getProduct(i);
                products.push({
                    id: i.toString(),
                    name: product[0],
                    basePrice: product[1].toString(),
                    state: product[2],
                    district: product[3],
                    market: product[4],
                    farmer: product[5],
                    priceTrail: product[6].map(p => p.toString()),
                    handlers: product[7]
                });
            } catch (err) {
                // Skip invalid products
                continue;
            }
        }

        res.status(200).json(products);
    } catch (error) {
        console.error("❌ Error fetching all products:", error);
        res.status(500).json({ error: error.message });
    }
});




module.exports = router;
