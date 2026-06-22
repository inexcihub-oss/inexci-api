export interface OpmeNamedRefDto {
  id: string;
  name: string;
}

export interface CreateOpmeResponseDto {
  id: string;
  surgeryRequestId: string;
  name: string;
  quantity: number;
  authorizedQuantity: number | null;
  selectedSupplierId: string | null;
  suppliers: OpmeNamedRefDto[];
  manufacturers: OpmeNamedRefDto[];
  createdAt: Date;
  updatedAt: Date;
  createdSupplierNames: string[];
  createdManufacturerNames: string[];
}
