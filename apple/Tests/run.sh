#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")/../.."
mkdir -p work/mobile-completion
xcrun swiftc -parse-as-library -o work/mobile-completion/mobile-regression \
  apple/KintampoMarket/Models/{Product,MoreModels}.swift \
  apple/KintampoManager/Models/{ManagerModels,StaffModels}.swift \
  apple/KintampoManager/Services/AdminAPI.swift \
  apple/KintampoMarket/Services/{AppConfig,APIClient,CartStore,CatalogStore,HomeMerchandising,SessionVault,StorefrontCatalog,SupabaseService}.swift \
  apple/KintampoMarket/Theme/StoreConfig.swift \
  apple/Tests/MobileRegression.swift
work/mobile-completion/mobile-regression
