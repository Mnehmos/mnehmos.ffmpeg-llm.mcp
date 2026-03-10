/**
 * Tests for asset tool operations.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { AssetTools } from '@/tools/asset';
import {
  createTestProject,
  createTestAsset,
  createTestClip,
  createTestTrack,
} from '../helpers/fixtures';
import { MockStorage, MockFFprobeRunner } from '../helpers/mocks';

describe('AssetTools', () => {
  let storage: MockStorage;
  let probeRunner: MockFFprobeRunner;
  let tools: AssetTools;

  beforeEach(() => {
    storage = new MockStorage();
    probeRunner = new MockFFprobeRunner();
    tools = new AssetTools(storage, probeRunner);
  });

  // -------------------------------------------------------------------------
  // asset_import
  // -------------------------------------------------------------------------

  describe('asset_import', () => {
    it('probes file and creates asset entry', async () => {
      const project = createTestProject();
      await storage.saveProject(project);

      const result = await tools.assetImport({
        projectId: project.id,
        filePath: '/tmp/video.mp4',
        tags: ['raw', 'chess'],
      });

      expect(result.asset).toBeDefined();
      expect(result.asset.path).toBe('/tmp/video.mp4');
      expect(result.asset.type).toBe('video');
      expect(result.asset.width).toBe(1920);
      expect(result.asset.height).toBe(1080);
      expect(result.asset.tags).toContain('raw');

      // Should have called ffprobe
      expect(probeRunner.calls).toHaveLength(1);
      expect(probeRunner.calls[0].args[0]).toBe('/tmp/video.mp4');
    });

    it('extracts duration from probe data', async () => {
      const project = createTestProject();
      await storage.saveProject(project);

      const result = await tools.assetImport({
        projectId: project.id,
        filePath: '/tmp/video.mp4',
      });

      expect(result.asset.duration).toBe(600);
    });

    it('persists asset to project', async () => {
      const project = createTestProject();
      await storage.saveProject(project);

      await tools.assetImport({
        projectId: project.id,
        filePath: '/tmp/video.mp4',
      });

      const updated = await storage.getProject(project.id);
      expect(updated!.assets).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // asset_batch_import
  // -------------------------------------------------------------------------

  describe('asset_batch_import', () => {
    it('imports multiple files and returns batch summary', async () => {
      const project = createTestProject();
      await storage.saveProject(project);

      const result = await tools.assetBatchImport({
        projectId: project.id,
        filePaths: ['/tmp/video1.mp4', '/tmp/video2.mp4', '/tmp/video3.mp4'],
      });

      expect(result.summary.total).toBe(3);
      expect(result.summary.successful).toBe(3);
      expect(result.summary.failed).toBe(0);
      expect(result.assets).toHaveLength(3);
    });

    it('handles partial failures gracefully', async () => {
      const project = createTestProject();
      await storage.saveProject(project);

      // Make the second probe call fail
      let callCount = 0;
      const originalProbe = probeRunner.probe.bind(probeRunner);
      probeRunner.probe = async (filePath: string) => {
        callCount++;
        if (callCount === 2) {
          throw new Error('File not found');
        }
        return originalProbe(filePath);
      };

      const result = await tools.assetBatchImport({
        projectId: project.id,
        filePaths: ['/tmp/video1.mp4', '/tmp/bad.mp4', '/tmp/video3.mp4'],
      });

      expect(result.summary.total).toBe(3);
      expect(result.summary.successful).toBe(2);
      expect(result.summary.failed).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // asset_remove
  // -------------------------------------------------------------------------

  describe('asset_remove', () => {
    it('fails if clips reference the asset', async () => {
      const asset = createTestAsset();
      const clip = createTestClip({ assetId: asset.id });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      await expect(
        tools.assetRemove({
          projectId: project.id,
          assetId: asset.id,
        }),
      ).rejects.toThrow();
    });

    it('succeeds with force flag even when referenced', async () => {
      const asset = createTestAsset();
      const clip = createTestClip({ assetId: asset.id });
      const track = createTestTrack({ clips: [clip] });
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [track], duration: 30, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await tools.assetRemove({
        projectId: project.id,
        assetId: asset.id,
        force: true,
      });

      expect(result.removed).toBe(true);
    });

    it('succeeds when asset is not referenced', async () => {
      const asset = createTestAsset();
      const project = createTestProject({
        assets: [asset],
        timeline: { tracks: [], duration: 0, chapters: [] },
      });
      await storage.saveProject(project);

      const result = await tools.assetRemove({
        projectId: project.id,
        assetId: asset.id,
      });

      expect(result.removed).toBe(true);
      const updated = await storage.getProject(project.id);
      expect(updated!.assets).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // asset_list
  // -------------------------------------------------------------------------

  describe('asset_list', () => {
    it('returns all assets', async () => {
      const assets = [
        createTestAsset({ type: 'video', tags: ['raw'] }),
        createTestAsset({ type: 'audio', tags: ['music'] }),
        createTestAsset({ type: 'image', tags: ['thumbnail'] }),
      ];
      const project = createTestProject({ assets });
      await storage.saveProject(project);

      const result = await tools.assetList({ projectId: project.id });

      expect(result.assets).toHaveLength(3);
    });

    it('filters by type', async () => {
      const assets = [
        createTestAsset({ type: 'video' }),
        createTestAsset({ type: 'audio' }),
        createTestAsset({ type: 'video' }),
      ];
      const project = createTestProject({ assets });
      await storage.saveProject(project);

      const result = await tools.assetList({
        projectId: project.id,
        type: 'video',
      });

      expect(result.assets).toHaveLength(2);
      expect(result.assets.every((a: any) => a.type === 'video')).toBe(true);
    });

    it('filters by tags', async () => {
      const assets = [
        createTestAsset({ tags: ['raw', 'chess'] }),
        createTestAsset({ tags: ['music'] }),
        createTestAsset({ tags: ['chess', 'edited'] }),
      ];
      const project = createTestProject({ assets });
      await storage.saveProject(project);

      const result = await tools.assetList({
        projectId: project.id,
        tags: ['chess'],
      });

      expect(result.assets).toHaveLength(2);
    });

    it('returns empty array when no assets match', async () => {
      const project = createTestProject({ assets: [] });
      await storage.saveProject(project);

      const result = await tools.assetList({ projectId: project.id });

      expect(result.assets).toHaveLength(0);
    });
  });
});
