const express = require('express');
const Product = require('../models/Product');
const contract = require('../blockchain');
const runPythonCheck = require('../utils/runPythonCheck');

const router = express.Router();

// POST /api/check-price
router.post('/check-price', async (req, res) => {
	try {
		const { commodity, state, district, market, vendor_price } = req.body;
		if (!commodity || !state || !district || !market || typeof vendor_price === 'undefined') {
			return res.status(400).json({ message: 'Missing required fields' });
		}
		const result = await runPythonCheck({
			commodity,
			state,
			district,
			market,
			vendor_price: Number(vendor_price)
		});

		if (result.status === 'error') {
			return res.status(502).json({ message: result.message });
		}
		return res.status(200).json(result);
	} catch (e) {
		return res.status(500).json({ message: e.message });
	}
});

// POST /api/products/qr-mapping (Store QR mapping after blockchain transaction)
router.post('/products/qr-mapping', async (req, res) => {
	try {
		const { blockchainProductId, txHash, qrCodeUrl, mlVerificationStatus, mlReason, marketModalPrice } = req.body;
		if (!blockchainProductId || !txHash || !qrCodeUrl) {
			return res.status(400).json({ message: 'Missing required fields: blockchainProductId, txHash, qrCodeUrl' });
		}
		const doc = await Product.create({
			blockchainProductId,
			txHash,
			qrCodeUrl,
			mlVerificationStatus: mlVerificationStatus || '',
			mlReason: mlReason || '',
			marketModalPrice: marketModalPrice || 0
		});
		return res.status(201).json({ id: doc._id, product: doc });
	} catch (e) {
		if (e.code === 11000) {
			return res.status(409).json({ message: 'QR mapping already exists for this blockchain product' });
		}
		return res.status(500).json({ message: e.message });
	}
});

// GET /api/products/match?commodity=...&state=...&district=...&market=...
// Returns blockchain product ID for the matching product
router.get('/products/match', async (req, res) => {
	try {
		const { commodity, state, district, market } = req.query;
		if (!commodity || !state || !district || !market) {
			return res.status(400).json({ message: 'commodity, state, district, market are required' });
		}
		
		const productCount = await contract.productCount();
		
		for (let i = 1; i <= productCount; i++) {
			try {
				const product = await contract.getProduct(i);
				if (product[0] && product[0].toLowerCase() === commodity.toLowerCase() &&
					product[2] && product[2].toLowerCase() === state.toLowerCase() &&
					product[3] && product[3].toLowerCase() === district.toLowerCase() &&
					product[4] && product[4].toLowerCase() === market.toLowerCase()) {
					return res.status(200).json({ blockchainProductId: i.toString() });
				}
			} catch (err) {
				continue;
			}
		}
		
		return res.status(404).json({ message: 'No matching product found on blockchain' });
	} catch (e) {
		console.error("❌ Error matching product:", e);
		let errorMessage = e.message;
		if (e.message.includes("network") || e.message.includes("connection") || e.message.includes("not connected")) {
			errorMessage = "Cannot connect to blockchain. Please ensure Hardhat node is running and contract is deployed.";
		}
		return res.status(500).json({ message: errorMessage });
	}
});

// GET /api/products/:id (Consumer view by QR id - fetches from blockchain)
router.get('/products/:id', async (req, res) => {
	try {
		const { id } = req.params;
		
		// Check if it's a MongoDB ObjectId (QR mapping) or blockchain product ID
		const isNumeric = /^\d+$/.test(id);
		
		if (isNumeric) {
			// Fetch from blockchain
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
			return res.status(200).json(formatted);
		} else {
			// Fetch QR mapping from MongoDB, then get blockchain data
			const doc = await Product.findById(id).lean();
			if (!doc) return res.status(404).json({ message: 'QR mapping not found' });
			
			// Fetch actual product data from blockchain
			const product = await contract.getProduct(doc.blockchainProductId);
			const formatted = {
				name: product[0],
				basePrice: product[1].toString(),
				state: product[2],
				district: product[3],
				market: product[4],
				farmer: product[5],
				priceTrail: product[6].map(p => p.toString()),
				handlers: product[7],
				blockchainProductId: doc.blockchainProductId,
				txHash: doc.txHash,
				mlVerificationStatus: doc.mlVerificationStatus,
				mlReason: doc.mlReason,
				marketModalPrice: doc.marketModalPrice
			};
			return res.status(200).json(formatted);
		}
	} catch (e) {
		return res.status(500).json({ message: e.message });
	}
});

// ---------------- Vendor options & lookup APIs ---------------- 
// Fetch from blockchain, not MongoDB
// GET /api/options/commodities
router.get('/options/commodities', async (req, res) => {
	try {
		const productCount = await contract.productCount();
		const commodities = new Set();
		
		for (let i = 1; i <= productCount; i++) {
			try {
				const product = await contract.getProduct(i);
				if (product[0]) commodities.add(product[0]); // name field
			} catch (err) {
				continue;
			}
		}
		
		const list = Array.from(commodities).filter(Boolean).sort((a, b) => a.localeCompare(b));
		return res.status(200).json(list);
	} catch (e) {
		return res.status(500).json({ message: e.message });
	}
});

// GET /api/options/states?commodity=...
router.get('/options/states', async (req, res) => {
	try {
		const { commodity } = req.query;
		if (!commodity) return res.status(400).json({ message: 'commodity is required' });
		
		const productCount = await contract.productCount();
		const states = new Set();
		
		for (let i = 1; i <= productCount; i++) {
			try {
				const product = await contract.getProduct(i);
				if (product[0] && product[0].toLowerCase() === commodity.toLowerCase() && product[2]) {
					states.add(product[2]); // state field
				}
			} catch (err) {
				continue;
			}
		}
		
		const list = Array.from(states).filter(Boolean).sort((a, b) => a.localeCompare(b));
		return res.status(200).json(list);
	} catch (e) {
		return res.status(500).json({ message: e.message });
	}
});

// GET /api/options/districts?commodity=...&state=...
router.get('/options/districts', async (req, res) => {
	try {
		const { commodity, state } = req.query;
		if (!commodity || !state) return res.status(400).json({ message: 'commodity and state are required' });
		
		const productCount = await contract.productCount();
		const districts = new Set();
		
		for (let i = 1; i <= productCount; i++) {
			try {
				const product = await contract.getProduct(i);
				if (product[0] && product[0].toLowerCase() === commodity.toLowerCase() &&
					product[2] && product[2].toLowerCase() === state.toLowerCase() && product[3]) {
					districts.add(product[3]); // district field
				}
			} catch (err) {
				continue;
			}
		}
		
		const list = Array.from(districts).filter(Boolean).sort((a, b) => a.localeCompare(b));
		return res.status(200).json(list);
	} catch (e) {
		return res.status(500).json({ message: e.message });
	}
});

// GET /api/options/markets?commodity=...&state=...&district=...
router.get('/options/markets', async (req, res) => {
	try {
		const { commodity, state, district } = req.query;
		if (!commodity || !state || !district) {
			return res.status(400).json({ message: 'commodity, state and district are required' });
		}
		
		const productCount = await contract.productCount();
		const markets = new Set();
		
		for (let i = 1; i <= productCount; i++) {
			try {
				const product = await contract.getProduct(i);
				if (product[0] && product[0].toLowerCase() === commodity.toLowerCase() &&
					product[2] && product[2].toLowerCase() === state.toLowerCase() &&
					product[3] && product[3].toLowerCase() === district.toLowerCase() && product[4]) {
					markets.add(product[4]); // market field
				}
			} catch (err) {
				continue;
			}
		}
		
		const list = Array.from(markets).filter(Boolean).sort((a, b) => a.localeCompare(b));
		return res.status(200).json(list);
	} catch (e) {
		return res.status(500).json({ message: e.message });
	}
});

module.exports = router;



