import { Router } from 'express';
import { metadataSchemaRegistry } from '../../src/core/index.js';
import { PlatformError, ErrorTypes, SuggestedActions } from '../../src/core/error-envelope.js';

const router = Router();

/**
 * @route GET /api/schemas
 * @desc Get a list of all registered metadata schemas
 * @access Public
 */
router.get('/', (req, res) => {
  try {
    const schemas = metadataSchemaRegistry.listSchemas();
    res.json({
      success: true,
      data: { schemas }
    });
  } catch (error) {
    const statusCode = error instanceof PlatformError ? error.statusCode : 500;
    const body = error instanceof PlatformError
      ? error.toEnvelope()
      : { code: 'XACT_5000', message: (error instanceof Error ? error.message : String(error)) };
    res.status(statusCode).json({ success: false, error: body });
  }
});

/**
 * @route GET /api/schemas/:platform/:category
 * @desc Get the JSON schema definition for a specific platform and category
 * @access Public
 */
router.get('/:platform/:category', (req, res) => {
  const { platform, category } = req.params;
  
  try {
    const schema = metadataSchemaRegistry.getSchema(platform, category);
    
    if (!schema) {
      throw new PlatformError({
        type: ErrorTypes.INTERNAL,
        code: 'XACT_4041',
        message: `Schema not found for platform: ${platform}, category: ${category}`,
        statusCode: 404,
        platform,
        suggestedAction: SuggestedActions.USE_ACTIONS_LIST
      });
    }

    res.json({
      success: true,
      data: { platform, category, schema }
    });
  } catch (error) {
    if (error instanceof PlatformError) {
      res.status(error.statusCode || 400).json({ success: false, error: error.toEnvelope() });
    } else {
      res.status(500).json({ success: false, error: (error instanceof Error ? error.message : String(error)) });
    }
  }
});

export default router;
