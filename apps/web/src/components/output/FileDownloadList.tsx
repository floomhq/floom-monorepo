import { FileDownload } from './FileDownload';

export interface ArtifactDownload {
  id?: string;
  name: string;
  mime?: string;
  size?: number;
  url: string;
  sha256?: string;
  expires_at?: string;
}

export interface FileDownloadListProps {
  artifacts: ArtifactDownload[];
}

export function FileDownloadList({ artifacts }: FileDownloadListProps) {
  if (artifacts.length === 0) return null;

  return (
    <div
      data-renderer="FileDownloadList"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {artifacts.map((artifact, index) => (
        <FileDownload
          key={artifact.id || `${artifact.name}-${index}`}
          url={artifact.url}
          filename={artifact.name}
          mime={artifact.mime}
          size={artifact.size}
        />
      ))}
    </div>
  );
}
